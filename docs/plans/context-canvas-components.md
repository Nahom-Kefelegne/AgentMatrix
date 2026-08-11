# Context Canvas Component Roadmap

Status: **Locations and Decision implemented locally; remaining components planned**

Related foundations:

- `docs/plans/context-canvas-agent-tools.md`
- `docs/plans/context-canvas-ui-foundation.md`

## 1. Product Contract

Context Canvas is the evidence surface beside a live coding session. Its single
job is to remove the user's next manual navigation, comparison, review, or
copy/paste step without taking ownership away from the terminal.

Every component follows the same seamlessness rules:

1. The terminal remains mounted and keeps keyboard focus.
2. Selected-session evidence previews passively.
3. Background-session evidence queues.
4. Pinned or human-opened content is not replaced by an agent.
5. The same retained artifact updates or replaces in place where its tool
   contract says it should.
6. Switching sessions restores that session's Canvas state.
7. Back/Forward crosses typed artifacts and existing Code/Document/Changes.
8. Components render typed, validated host data; never model-provided HTML.
9. Every component provides enough terminal text fallback to remain useful when
   the Canvas is closed.
10. Unsupported artifacts remain retained until their renderer ships.

## 2. Visual Direction

The Canvas should read as a **developer evidence ledger**, not a dashboard of
cards and not a miniature IDE.

### Existing palette

No new global palette is introduced:

- Instrument surface: `#131316`
- Deep evidence well: `#0c0c11`
- Structural line: existing `--mc-line` / `--mc-line-strong`
- Operational violet: existing `--mc-review`
- Warning amber: existing `--mc-warning`
- Critical red: existing `--mc-critical`
- Primary/muted text: existing `--mc-ink` / `--mc-muted` / `--mc-faint`

### Typography

- Human-readable titles and explanations: existing UI sans.
- Paths, ranges, commands, timestamps, and raw evidence: existing UI monospace.
- Components do not introduce remote fonts or their own type systems.

### Layout language

Content uses rows, groups, rails, and evidence panes because those structures
encode relationships. Avoid a repeated rounded-card grid.

### Signature

The shared visual signature is an **evidence spine**: a quiet vertical or
horizontal structural line connecting related evidence. It first appears in
Locations, then can naturally extend to validation failures, plan phases, and
runtime evidence.

No ambient animation is added. State changes use color, weight, and small
structural transitions only.

## 3. Component Sequence

| Order | Component | Tool | Infrastructure it proves |
|---|---|---|---|
| Existing | Code / Document | `present_code` | Typed routing into existing renderers, file validation, history |
| Existing | Changes | `present_changes` | Typed routing into a stateful existing renderer, request refresh |
| 1 | Locations | `present_locations` | First new renderer, queue activation, typed-to-Code history |
| 2 | Decision (implemented locally) | `request_decision` | User interaction delivery, blocking lifecycle, session attention |
| 3 | Validation | `present_validation` | Status/provenance, actionable failure links, retained evidence |
| 4 | Plan | `update_plan` | Same-kind replacement, persistent session artifact, progress states |
| 5 | Runtime Evidence | `present_runtime_evidence` | Dense bounded payloads, disclosure, copying, source links |
| 6 | Browser Preview | `present_browser_preview` | Sandboxed runtime surface, process availability, reload lifecycle |
| Later | Queue Drawer | all tools | Multi-artifact browsing and dismissal |
| Later | Session Indicators | all tools | Background attention without stealing the active Canvas |

Locations is first because it is read-only and complete in one request. It tests
the new framework without introducing response delivery, command execution,
streaming, or browser security.

## 4. Existing Components to Preserve

### Code

Current renderer: `CodePreview`.

The new framework should not redesign it before Locations ships. Later
solidification can add:

- Copy Path
- Open in Full Editor
- explicit current/stale metadata
- clearer range label

### Document

Current renderer: `MarkdownPreview`.

Preserve:

- Preview/Source
- secure repository links
- large-document guard
- automatic design-document preview

Later work can add a compact outline and validated images.

### Changes

Current renderer: `DiffCanvas`.

Preserve:

- session attribution
- comments and review delivery
- inline/split diff
- full-file handoff

Each new typed Changes request already remounts the diff data boundary by
`requestRef`.

## 5. Component 1: Locations

Implementation status: **Complete locally**

### 5.1 Purpose

Locations answers:

> “Which exact places in the repository matter, and why?”

It is not repository search. The session has already investigated and supplies
verified locations. The component presents those findings for comparison and
lets the user move into Code without losing the list.

### 5.2 Typed contract

Use the existing request unchanged:

```ts
interface LocationsCanvasRequest {
  kind: 'locations';
  title: string;
  summary: string;
  payload: {
    locations: Array<{
      path: string;
      line: number;
      column?: number;
      endLine?: number;
      endColumn?: number;
      label?: string;
    }>;
  };
}
```

The server already guarantees:

- 1–30 entries
- repository-relative canonical file paths
- regular displayable files
- valid line and column bounds
- no unknown fields

The component performs no repository search and no file fetch on initial
render.

### 5.3 Component API

Proposed file:

`app/components/context-canvas/LocationsArtifact.tsx`

```ts
interface LocationsArtifactProps {
  request: LocationsCanvasRequest;
  onOpenLocation(
    target: NavigationTarget,
    summary: string,
  ): void;
}
```

Do not pass the entire Canvas controller. This keeps the renderer focused and
testable.

### 5.4 Rendering

Locations are grouped by file while preserving first-seen file order and
location order within each file.

```text
┌ Relevant authentication flow ─────────────────────┐
│ 3 verified locations                              │
├───────────────────────────────────────────────────┤
│ src/auth/session.ts                               │
│ │ 42:5   Creates and signs the refresh token      │
│ │ 88:1   Invalidates the prior session            │
│                                                   │
│ src/api/login.ts                                  │
│ │ 31:9   Calls session creation after validation  │
└───────────────────────────────────────────────────┘
```

The thin location rail is the evidence spine. It communicates that rows belong
to one file and avoids card-per-location visual noise.

Each row shows:

- line or line:column
- optional end range
- agent-provided label
- path only once in the file group

If a label is absent, use `Open path:line`, not invented explanatory copy.

### 5.5 Interaction

Each location row is one keyboard-focusable disclosure button.

Click or Enter expands a lightweight code preview directly below that card.
Only one inline preview is open at a time in V1 so the evidence list remains
scannable.

The inline preview:

- fetches the validated file lazily on first expansion
- shows a bounded context window around the requested range
- highlights the exact requested lines
- compacts very large ranges to a bounded head/tail preview with an explicit
  omitted-line marker
- has a maximum vertical height and both vertical/horizontal scrolling
- does not create a history entry
- does not mount Monaco

Monaco remains the full Code artifact. Each expanded preview includes an
**Open in Code** action that calls:

```ts
onOpenLocation(
  {
    path,
    range: {
      start: { line, column },
      end: endLine
        ? { line: endLine, column: endColumn }
        : undefined,
    },
  },
  label ?? `Open ${path}:${line}`,
);
```

This creates a developer-owned Code navigation entry:

```text
Locations → Code → Back → Locations
```

Because Code is human-opened, subsequent agent artifacts queue rather than
replacing it.

The production implementation should use the existing validated navigation-file
endpoint and cache, but introduce a small lazy snippet hook/component rather
than mounting one Monaco editor per location. Monaco per row would add a large
bundle/runtime cost, duplicate editor models, and create competing scroll/focus
surfaces.

### 5.6 Canvas integration

Implementation changes:

1. Add `locations` to `CANVAS_RENDERED_KINDS`.
2. Add `'locations'` to `CanvasRendererKind`.
3. Add the exhaustive `locations` branch in `artifactRenderer()`.
4. Dynamically import `LocationsArtifact` in `ContextCanvas`.
5. Render it directly from the typed request.
6. Pass `controller.openFile` as `onOpenLocation`.
7. Reuse the current title, summary, provenance, timestamp, queue, pin, close,
   and Back/Forward chrome.

No backend, MCP schema, request-store, socket, or reducer change should be
needed. If implementation requires one, treat that as feedback that the
foundation contract is incomplete and document why.

### 5.7 Styling

Add a small set of `cc-locations-*` styles to `context-canvas.css`:

- full-height scrollable list
- file group header
- evidence spine
- location row hover/focus
- monospace path/range
- readable label wrapping

Rows use `content-visibility: auto` only if measurement shows a benefit; the
maximum list is 30, so virtualization is unnecessary.

No new animation.

### 5.8 Accessibility

- Outer list: `role="list"`.
- File group uses a semantic heading.
- Rows are native buttons.
- Accessible label includes path, line, and description.
- Visible focus follows existing Canvas ring tokens.
- Range punctuation is not the only indication of meaning.
- At narrow widths, labels wrap rather than paths becoming unreadable.

### 5.9 Empty and error states

The server disallows an empty list, so an empty state indicates corrupted or
stale client data:

```text
No locations available
The session did not provide any repository locations.
```

Locations has no loading or retry state because its payload is complete. This
is intentional and avoids introducing a premature shared StateBoundary.

### 5.10 Framework test matrix

#### Pure routing

- `artifactRenderer(locations)` returns `locations`.
- Existing Code, Document, Search, Diff, and Review branches remain unchanged.
- Renderer availability response changes from `event_only` to
  `canvas_renderer` through the shared capability list.

#### State behavior

- Selected session + unprotected Canvas: opens Locations.
- Background session: queues.
- Pinned Canvas: queues.
- Human-opened Code: queues.
- Reconnect snapshot: restores unknown Locations.
- Duplicate requestRef: ignored.
- Close watermark: stale replay remains queued.
- Unsupported requests ahead of Locations do not starve it.

#### History

- Location click opens Code.
- Location row expands/collapses its inline code preview.
- Inline code is independently scrollable.
- Expanding another row closes the previous inline preview.
- Open in Code opens the full Monaco-backed Code artifact.
- Back restores the exact typed Locations artifact.
- Forward restores Code.
- Back then another location creates a new history branch.

#### Session lifecycle

- Session switch restores Locations.
- Session end removes it.
- Renderer remount does not lose it.

#### Visual/manual

- 1, 5, and 30 locations.
- Many locations in one file.
- One location per many files.
- Long Windows-compatible repository paths.
- Missing labels.
- Narrow Canvas / bottom-drawer layout.
- Keyboard-only navigation.
- Dark and light application themes.

### 5.11 Acceptance criteria

Locations is complete when:

1. A real managed session calls `present_locations`.
2. The selected session shows Locations without stealing terminal focus.
3. A background session queues it.
4. Clicking a row opens the exact Code range.
5. Back returns to Locations.
6. Pinning prevents replacement.
7. Reconnect restores it once without duplication.
8. Existing Code, Document, and Changes behavior is unchanged.
9. TypeScript and production build pass.
10. A screenshot review confirms the component reads as an evidence ledger,
    not a generic card list.

## 6. Component 2: Decision

Decision is the first interactive artifact.

Implementation status: **Complete locally**

Locations proved typed rendering, queueing, history, reconnect restoration, and
typed-to-Code handoff. Decision can now extend that foundation without changing
the agent-facing request schema.

### 6.1 Purpose

Decision answers:

> “What concrete judgment is blocking this session, and how can I answer it
> without leaving the conversation?”

The component is a blocking interaction surface, not a generic survey. One
pending decision is retained per session. The session asks once, provides a
concise terminal fallback, and waits.

### 6.2 Typed contract

The existing request remains the source of truth:

```ts
interface DecisionCanvasRequest {
  kind: 'decision';
  title: string;
  summary: string;
  payload: {
    question: string;
    options: Array<{
      id: string;
      label: string;
      description?: string;
    }>;
    allowCustom: boolean;
    resolution?: {
      kind: 'option' | 'custom';
      optionId?: string;
      answer: string;
      respondedAt: number;
    };
  };
}
```

`resolution` is host-authored only. It is never accepted from MCP input.

The server already guarantees:

- 2–6 options
- unique option IDs
- bounded labels and descriptions
- `allowCustom` defaults to true
- same-kind retained replacement
- session attention when the request is accepted

### 6.3 Response boundary

`POST /api/canvas/decision` is protected by the Electron renderer token.

Request:

```ts
{
  sessionId: string;
  requestRef: string;
  optionId?: string;
  customAnswer?: string;
}
```

Exactly one of `optionId` or `customAnswer` is required. The route:

1. verifies the trusted renderer
2. verifies the live session and retained pending request
3. verifies the option ID or custom-answer permission
4. rejects unknown fields and overlong/unsafe-control-character input
5. submits one normalized prompt through `PtyManager.sendPrompt()`
6. waits until the prompt is actually written to the PTY
7. cancels queued delivery if the CLI exits or does not become ready in 30 seconds
8. records the host-authored resolution only after the write succeeds
9. clears attention to working
10. emits the resolved request to connected renderers

`PtyManager.sendPrompt()` is the delivery boundary because it resolves only
after writing. It writes immediately when the CLI is ready and otherwise holds
one prompt until provider prompt detection or the authoritative Stop hook
reports turn completion. Timeout, PTY exit, or write failure rejects the
response without clearing attention or resolving the artifact. Decision does
not write directly to xterm or depend on the selected session.

Concurrent retries with the same response share one delivery and are
idempotent. A second, different response returns conflict and never reaches the
PTY.

### 6.4 Component API

Implementation file:

`app/components/context-canvas/DecisionArtifact.tsx`

```ts
interface DecisionArtifactProps {
  request: DecisionCanvasRequest;
  onResolved(request: DecisionCanvasRequest): void;
}
```

The component owns transient selection, custom text, submitting, and error
state. The controller owns the resolved request so Back/Forward, remount, and
reconnect display the same answer.

### 6.5 Rendering

Decision extends the evidence-ledger language with a **branch rail**: a single
vertical decision spine with one node per valid path. It visually encodes
mutually exclusive branches without becoming a grid of generic cards.

```text
  Decision required
  Which storage should this implementation use?

  ◇── PostgreSQL
  │   Durable shared deployment
  │
  ◇── SQLite
  │   Local single-user deployment
  │
  ◇── Another answer
      [ custom response                          ]

                              [Send decision]
```

The selected branch receives the existing operational violet. The surrounding
surface remains quiet. Critical red is reserved for delivery failure, not for
the normal fact that a decision is pending.

### 6.6 Interaction

- Options use native radio semantics inside one fieldset.
- Clicking a row selects it; arrow keys follow browser radio behavior.
- Optional custom input is the final branch and has a 2,000-character limit.
- Enter submits from a selected option; custom multiline input requires the
  explicit Send action so line breaks do not submit accidentally.
- No input auto-focuses when Canvas opens, preserving terminal focus.
- Submission disables every choice immediately.
- A failed response remains pending and provides a specific retry message.
- A resolved response becomes a read-only receipt with the chosen answer and
  response time.
- Request arrival never moves focus. After an explicit keyboard/mouse submit,
  focus moves to the receipt rather than falling back to the page body.
- Resolution does not close Canvas; the CLI begins processing beside the
  retained receipt.

### 6.7 Canvas integration

1. Add `decision` to `CANVAS_RENDERED_KINDS`.
2. Add a `decision` renderer branch to the exhaustive artifact switch.
3. Dynamically import `DecisionArtifact`.
4. Add `canvas:decision-resolved` to the typed socket contract.
5. Replace the matching request in active content, history, and queue.
6. Merge a resolved snapshot into an unresolved local artifact with the same
   requestRef.
7. Preserve normal selected/background/pin/close behavior.

### 6.8 Accessibility and responsive behavior

- Native `fieldset`, `legend`, and radio inputs.
- Full visible question; no tooltip-only context.
- Labels and descriptions wrap at narrow widths.
- Error uses `role="alert"`; delivery progress and resolution use polite status.
- Existing focus-ring tokens remain visible.
- Branch nodes are decorative and never the only selected-state indicator.
- Reduced motion requires no special path because Decision adds no animation.

### 6.9 Validation matrix

#### Server

- valid option response reaches the owning session once
- valid custom response is accepted only when enabled
- wrong session/request/option is rejected
- unknown fields and unsafe control characters are rejected
- same retry is idempotent
- conflicting retry returns 409
- ended/disconnected session does not resolve the request
- attention clears only after `sendPrompt()` accepts delivery
- queued delivery resolves only after the actual PTY write
- timeout and PTY exit preserve the pending decision

#### Client state

- selected-session decision opens immediately
- background and pinned decisions queue
- queued Decision becomes actionable after renderer availability changes
- live resolution updates active/history/queue copies
- reconnect restores pending or resolved state
- resolved snapshot upgrades an unresolved cached copy
- duplicate resolution events are no-ops
- a request that arrives before a newly spawned session appears in the
  renderer's active-session map is retained rather than pruned

#### Interaction

- keyboard-only option selection and submit
- custom answer selection and explicit submit
- double-click cannot send twice
- failure preserves the selected answer
- no focus movement on request arrival or successful response

### 6.10 Acceptance criteria

Decision is complete when:

1. A real managed session calls `request_decision`.
2. The selected session shows a usable decision without stealing terminal focus.
3. The session enters attention and remains there while pending.
4. One option or custom answer is delivered once to the originating CLI.
5. The session returns to working after accepted delivery.
6. The Canvas keeps a resolved receipt across history and reconnect.
7. Background, pin, close watermark, and queue behavior remain correct.
8. TypeScript, production build, protocol probes, and live interaction pass.

Live validation completed with a temporary managed Copilot session:

- request arrived through the real MCP server
- terminal focus remained on xterm
- safe option reached the PTY after Stop
- attention changed to working only after the write
- resolved receipt survived renderer reload
- temporary session was removed afterward

Screenshots:

- `decision-canvas-pending.png`
- `decision-canvas-resolved.png`

## 7. Component 3: Validation

Validation adds:

- passed/failed/warning treatment
- `session_reported` provenance
- command display
- failure rows that open Code

It should reuse the Locations evidence-spine language for failures rather than
inventing a new card layout.

Authoritative run references and rerun controls remain a later extension.

## 8. Component 4: Plan

Plan proves same-kind replacement:

- one retained plan per session
- pending/in-progress/done/blocked items
- active phase emphasis
- silent update while visible

V1 replaces the full item list. No patch operation or nested task tree.

## 9. Component 5: Runtime Evidence

Runtime Evidence proves bounded dense content:

- log, error, and request entries
- collapsed disclosure rows
- copy action
- optional Code links
- capture timestamp and source

No streaming in V1.

## 10. Component 6: Browser Preview

Browser Preview is intentionally last:

- loopback HTTP(S) only
- sandboxed webview/iframe policy
- server-unavailable state
- reload and viewport presets
- open externally

Console/network capture, screenshots, and interaction recording are later
extensions.

## 11. Later Shared UI

### Queue Drawer

Build after at least three artifact types are active. Before then, the existing
count and next-item action are sufficient.

### Session Indicators

Add after Decision and Validation establish meaningful background severity:

- blocking decision
- failed validation
- queued artifact count

Avoid adding indicators for every passive Code or Locations preview.
