# Context Canvas Agent Tools - Backend-First Implementation Plan

Status: **Implemented**

## 1. Goal

Add the new AgentMatrix MCP presentation tools now, without waiting for every
Canvas component to exist and without replacing the working navigation stack.

The first release standardizes the agent-facing API, validation, event transport,
and model instructions. Components will subscribe to the typed requests as they
are built.

Existing MCP tools remain available for compatibility and can be deprecated
later.

## 2. Tools

The new tools are:

- `present_code`
- `present_locations`
- `present_changes`
- `request_decision`
- `present_validation`
- `update_plan`
- `present_runtime_evidence`
- `present_browser_preview`

`request_attention` and `work_complete` remain status tools.

## 3. Small Initial Contract

The initial protocol is `agentmatrix.canvas/v1`.

Every request receives server-owned:

- `requestRef`
- `sessionId`
- `repoRef`
- `source`
- `createdAt`

The model supplies only the typed payload and a concise explanation. It cannot
choose another session, repository root, arbitrary HTML, Canvas focus, layout,
or replacement policy.

The protocol is a discriminated union rather than an open-ended payload:

```ts
type CanvasRequest =
  | CodeCanvasRequest
  | LocationsCanvasRequest
  | ChangesCanvasRequest
  | DecisionCanvasRequest
  | ValidationCanvasRequest
  | PlanCanvasRequest
  | RuntimeEvidenceCanvasRequest
  | BrowserPreviewCanvasRequest;
```

Lifecycle operations, patch semantics, streaming updates, and generic artifact
metadata are deliberately deferred until a component needs them.

## 4. Compatibility Delivery

### Existing renderers

- `present_code` is adapted client-side to the existing Code/Document renderer.
- `present_changes` is adapted client-side to the existing session review renderer.

These tools should open the current Context Canvas immediately.

### Components not built yet

The remaining tools emit:

- `canvas:requested`
- `canvas:acknowledged`

Their result is explicitly marked as `event_only`. MCP responses instruct the
session to include a concise terminal fallback. They must not claim the user saw
a component that is not connected yet.

Typed requests are retained in a bounded, session-scoped in-memory store and
replayed as `canvas:snapshot` when the renderer reconnects. Disk persistence and
component-level applied/consumed acknowledgements are deferred. Retention is
bounded by request count, per-session bytes, global bytes, and a 24-hour expiry.
An explicit session end clears its retained requests.

Snapshot replay is hydration only: known or stale Code/Changes requests are
ignored, while a genuinely newer request that arrived during disconnect is
applied through the normal preview/queue/pin policy. It never reopens an already
dismissed request or replaces newer local history.

`request_decision` also marks the session as requiring attention and replaces
any older pending decision for that session. Until its
component is connected, the agent asks the same question once in the terminal
and then waits.

`update_plan` replaces the previously retained plan for that session. The first
version survives Canvas/view remounts and renderer reconnects within the running
AgentMatrix process; durable restart persistence is deferred.

## 5. Validation Rules

- Session identity comes only from the managed process capability.
- Unknown top-level and nested fields are rejected server-side independently of
  MCP client schema enforcement.
- Repository paths are relative POSIX paths and are canonicalized under the
  registered session root.
- Location, failure, and evidence arrays are bounded.
- Decision option and plan item IDs must be unique.
- Browser previews initially allow loopback HTTP(S) URLs only.
- Runtime evidence text is bounded and must not contain secrets.
- Validation reports are labeled session-reported until authoritative run
  references are implemented.
- No tool returns repository contents to the model.

## 6. Prompt Policy

The model-facing policy has three layers:

1. Tool descriptions: short positive and negative trigger.
2. MCP server instructions: complete selection matrix and anti-spam rules.
3. Managed-session system prompt: concise mandatory reminder.

Primary selection matrix:

| Situation | Tool |
|---|---|
| Exact file or range helps the user | `present_code` |
| Several verified locations matter | `present_locations` |
| A meaningful edit set is ready for review | `present_changes` |
| Human judgment blocks progress | `request_decision` |
| Tests, build, or lint actually ran | `present_validation` |
| The work enters a meaningful new phase | `update_plan` |
| Observed runtime behavior proves a point | `present_runtime_evidence` |
| A known local web app should be inspected | `present_browser_preview` |

Global rules:

- Anticipate the user's next inspection step, but do not present routine
  internal exploration.
- Prefer one primary Canvas presentation per turn.
- Never fabricate paths, locations, validation results, runtime evidence, or
  browser availability.
- Do not duplicate automatic `docs/design` Markdown preview.
- A queued or pinned response is success; do not retry repeatedly.
- Always include a concise text fallback.
- `request_decision` is blocking: present, provide one fallback sentence, then
  stop and wait.

## 7. Compatibility Policy

The existing tools remain listed:

- `open_file`
- `reveal_range`
- `open_symbol`
- `show_search_results`
- `open_diff`
- `open_review`

Instructions tell new sessions to prefer the new tools. No compatibility tool is
removed in this change.

## 8. Validation

Before shipping:

1. Verify all tools appear in MCP `tools/list`.
2. Exercise every schema with accepted and rejected payloads.
3. Confirm session identity cannot be supplied in tool arguments.
4. Confirm Code and Changes reach the current Canvas renderers.
5. Confirm other requests emit the typed socket events.
6. Confirm Decision marks the session as attention.
7. Confirm browser preview rejects non-loopback URLs.
8. Run TypeScript and production build.
9. Review prompts for contradictory or spam-inducing guidance.
