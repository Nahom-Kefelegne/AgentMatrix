# Context Canvas UI Foundation

Status: **Implemented**

## Goal

Connect the typed `agentmatrix.canvas/v1` requests to the existing Context
Canvas through a production-ready, extendable client state model, without
introducing a renderer registry, a new state library, or speculative lifecycle
machinery.

The first component built after this foundation will validate whether the
contract needs to grow.

“Small” in this plan means a narrow public surface, not reduced reliability.
The foundation must handle delivery races, reconnects, duplicates, bounded
memory, session teardown, history branching, pin protection, background queues,
and compatibility with existing navigation before a new component relies on it.

## Current Problem

The Canvas client currently stores only legacy `NavigationRequest` objects.
New typed Canvas requests are retained server-side, while the client historically
stored only legacy navigation requests. Without a unified client artifact type,
new request kinds cannot enter the same queue, pin, history, reconnect, and
session-restoration policy.

## Client Contract

The client stores one small union:

```ts
type CanvasArtifact =
  | { type: 'navigation'; request: NavigationRequest }
  | { type: 'typed'; request: CanvasRequest };
```

Per-session state becomes:

```ts
interface SessionCanvasState {
  visible: boolean;
  activeArtifact: CanvasArtifact | null;
  disposition: 'preview' | 'pinned';
  history: CanvasArtifact[];
  historyIndex: number;
  queuedArtifacts: CanvasArtifact[];
}
```

No second client store is added. `useContextCanvas` remains the owner of
session-scoped Canvas state and its existing module cache continues to preserve
state across Dashboard remounts.

State changes run through a pure exported transition:

```ts
reduceCanvasArtifact(state, artifact, selectedSessionId)
```

This is the single policy boundary for selected/background delivery, pin
protection, unsupported kinds, deduplication, and queueing. It is testable
without rendering React.

## Render Support

One explicit switch determines what can render now:

| Artifact | Renderer |
|---|---|
| Legacy file/range | Existing Code or Document |
| Legacy search | Existing Search |
| Legacy diff/review | Existing Diff |
| Typed Code | Existing Code or Document |
| Typed Changes | Existing Diff |
| Other typed kinds | Queued until their component exists |

There is no plugin registry. `artifactRenderer()` is an exhaustive typed switch
and the deliberate extension point. Adding Locations next means:

1. Add `locations` to the shared `CANVAS_RENDERED_KINDS` capability list.
2. Add one dynamic component import.
3. Add one render branch.

Unknown future kinds remain queued rather than rendering a broken placeholder.

## Delivery

New MCP tools emit `canvas:requested` only.

- Typed Code and Changes are adapted to the existing component prop shape in
  the renderer.
- Legacy MCP tools and terminal links continue to emit `navigation:requested`.
- `canvas:snapshot` hydrates requests received while the renderer was absent.

The same `requestRef` is preserved through state, history, queue, and component
adaptation.

The socket contract is fully typed. Live typed requests and reconnect snapshots
enter the same reducer, so behavior does not vary by delivery path.

## State Rules

The existing seamlessness policy applies to both sides of the union:

1. Selected session + renderable artifact + Canvas unprotected: preview.
2. Background session: queue.
3. Pinned Canvas: queue agent/session-event artifacts.
4. Developer-opened and terminal-link artifacts are human-owned; incoming agent
   artifacts queue instead of replacing them.
5. Unsupported typed kind: queue.
6. Duplicate `requestRef`: ignore.
7. Code, Changes, Plan, and Decision replacement already occurs in the
   server-side retained request store.
8. Closing Canvas preserves history and queued artifacts.
9. Snapshot hydration never discards an accepted unknown request: older requests
   queue, while newer requests enter normal preview/queue policy.
10. Switching sessions restores that session's active artifact.
11. Opening an artifact never requests Canvas keyboard focus.
12. Session end removes local state, timers, and retained server artifacts.
13. History branches correctly after Back followed by a new open.
14. Queue and history sizes are bounded.
15. A queued unsupported artifact cannot block opening a later supported one.
16. Explicit close records a watermark; older requests recovered by snapshot
    remain queued rather than reopening the Canvas.
17. Visibility is independent from active content, so unsupported-only queues
    can surface and can still be explicitly closed.
18. A newer request received while the session is in the background may surface
    when that session is selected; queued work older than the close watermark
    remains suppressed.
19. When a session is selected, a newer queued renderable artifact replaces
    older agent-owned content, but never pinned or human-owned content.

## Shared Header Contract

`ContextCanvas` derives the existing header from either artifact type:

- title
- summary
- source label
- created time
- pin state
- queue count

No new header component is extracted in this phase.

If the queue contains only unsupported kinds, the Canvas remains visible with
the queue count and an explanatory empty state; the open action is disabled.
Once a renderer is added, the same retained request becomes actionable without
a protocol migration.

## Deliberate Non-Goals

- No universal StateBoundary.
- No Redux, Zustand, or context-level artifact store.
- No generic renderer registration.
- No patch/update lifecycle.
- No new visual component.
- No queue drawer.
- No session-row indicators.
- No durable disk persistence.

## Production Invariants

1. A typed request is accepted once and rendered or queued once.
2. Live delivery and snapshot replay use the same ID and transition policy.
3. Server timestamps reflect validated acceptance order, not request-start
   order, so concurrent validation cannot reorder retained updates.
4. User-close, pin, human-owned content, and newer local history are not
   overwritten by stale replay.
5. Requests received while disconnected are recovered or queued, never silently
   dropped due to timestamp ordering.
6. Existing legacy navigation remains functional and shares history with typed
   artifacts.
7. Unsupported kinds remain retained and bounded, never silently discarded.
8. All state collections have explicit limits.
9. Terminal mounting, PTY visibility, and keyboard focus remain unchanged.
10. Adding a renderer does not require changing the MCP or server protocol.
11. The Canvas never renders arbitrary model-provided HTML or layout.
12. Socket listeners are installed from explicit connection state, not from a
    mutable ref that can miss first-load delivery.
13. Client queues enforce the same 1 MB per-session budget as the retained
    server request store.
14. A new Changes request remounts its data boundary so a request recovered
    after disconnect cannot reuse stale diff state.
15. Renderer availability is declared once in `CANVAS_RENDERED_KINDS` and is
    shared by server delivery responses and client routing.
16. Definitive session removal revokes its capability and retained Canvas state;
    routes revalidate both immediately before emission to close in-flight races.

## Validation

The implementation must prove:

1. Existing Code, Document, Search, and Changes behavior remains intact.
2. Typed Code and Changes render without a duplicate navigation event.
3. Unsupported typed requests queue and never show a broken placeholder.
4. Background and pinned requests queue.
5. Back/Forward works across legacy and typed artifacts.
6. Internal Markdown links can open legacy Code and return to the typed
   Document through Back.
7. Closing Canvas remains respected after snapshot replay.
8. A genuinely newer request received during disconnect is recovered.
9. Terminal focus and mounting behavior are unchanged.
