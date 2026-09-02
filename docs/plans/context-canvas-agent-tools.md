# Context Canvas Agent Tools - Backend-First Implementation Plan

Status: **Implemented**

Current decision (2026-08-03): repository and symbol search are disabled.
`open_symbol` and `show_search_results` are no longer advertised, and stale
calls return HTTP 410. The sections below retain the original implementation
record for context.

## 1. Goal

Add the new AgentMatrix MCP presentation tools now, without waiting for every
Canvas component to exist and without replacing the working navigation stack.

The first release standardizes the agent-facing API, validation, event transport,
and model instructions. Components will subscribe to the typed requests as they
are built.

The remaining MCP navigation tools stay available for compatibility and can be
deprecated later.

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

Patch semantics, streaming updates, and generic artifact metadata remain
deferred. Decision adds one narrow host-authored resolution lifecycle.

## 4. Compatibility Delivery

### Existing renderers

- `present_code` is adapted client-side to the existing Code/Document renderer.
- `present_locations` renders the verified-location ledger and can hand off to Code.
- `present_changes` supports legacy session review and preferred
  session-selected frozen worktree snapshots through the existing renderer.
- `request_decision` renders a blocking choice and a retained response receipt.
- `update_plan` renders the retained execution rail and replaces progress in place.

These tools should open the current Context Canvas immediately.

### Components not built yet

Validation, Runtime Evidence, and Browser Preview still emit:

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

`request_decision` marks the session as requiring attention and replaces any
older retained decision for that session. A trusted renderer response is
validated against the retained options, delivered once through the originating
PTY, and recorded only after the write succeeds. Resolution clears attention
to working and is replayed through snapshots.

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

The remaining compatibility tools are:

- `open_file`
- `reveal_range`
- `open_diff`
- `open_review`

Instructions tell new sessions to prefer the typed tools. Repository and symbol
search compatibility tools are disabled.

## 8. Validation

Before shipping:

1. Verify all tools appear in MCP `tools/list`.
2. Exercise every schema with accepted and rejected payloads.
3. Confirm session identity cannot be supplied in tool arguments.
4. Confirm Code and Changes reach the current Canvas renderers.
5. Confirm remaining unrendered requests emit the typed socket events.
6. Confirm Decision marks attention, delivers once, and retains its resolution.
7. Confirm browser preview rejects non-loopback URLs.
8. Run TypeScript and production build.
9. Review prompts for contradictory or spam-inducing guidance.
