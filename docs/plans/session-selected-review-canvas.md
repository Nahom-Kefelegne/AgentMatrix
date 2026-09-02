# Session-Selected Review Canvas

Status: **Implemented**

Date: 2026-09-02

Related:

- `docs/plans/context-canvas-components.md`
- `docs/plans/context-canvas-ui-foundation.md`
- `docs/plans/context-canvas-agent-tools.md`
- `docs/design/repository-flow-map.md`

## 1. Decision

Review changes from **agent-selected files resolved against the session's own
repository state**, instead of reconstructing a change set from the CLI
transcript.

```text
Session chooses WHAT to review.
AgentMatrix decides HOW that content is resolved, and freezes it.
The Canvas renders a frozen, expirable snapshot.
```

1. **The session owns scope.** It names exact files and why each matters.
2. **The host owns evidence.** Diffs come from the session's registered
   repository root, its branch, and its working tree.
3. **Review is stable and honest.** Content is frozen at capture; when the
   working tree moves on, the UI says so rather than quietly drifting.

### Why not keep transcript reconstruction

The current path replays transcript edits to rebuild a baseline
(`lib/cli/transcript/index.ts`). It depends on provider-specific event formats,
degrades when edits are lossy, already falls back to `git show HEAD:<path>`, and
cannot express "review this against `origin/main`".

### Why not let the model send diff text

The model must never be the source of evidence. It selects; the host reads from
disk and Git. This preserves the Canvas invariant that renderers show validated
host data, never model-authored content.

## 2. Current State (verified)

### Agent-facing contract

`present_changes` accepts only a fixed scope (`mcp-server/index.mjs:128-144`),
and `lib/canvas/requests.ts:438-446` rejects anything except `scope: 'session'`,
always producing `payload: { scope: 'session' }` (`lib/canvas/types.ts:96-101`).

### Rendering path

A typed `changes` request is adapted into a **legacy navigation request**
(`canvasArtifact.ts:136-175`) with `diff.source: 'session'`. `DiffCanvas` renders
`SessionDiffCore`, which independently fetches `/api/sessions/changes`
(`SessionDiffCore.tsx:72-74`). The typed request carries no file data today.

### Diff computation

`/api/sessions/changes` reconstructs baselines from the transcript.
`lib/navigation/requests.ts:155-168` rejects every `DiffSourceKind` other than
`session`, though `branch` and `worktree` exist in the type
(`lib/navigation/types.ts:56-62`).

### Existing capability to reuse

| Capability | Location |
|---|---|
| Repo root discovery with abort/ENOENT/exit-code handling | `NavigationService.ts:286-309` |
| Safe `spawn` pattern with stderr capture and output caps | `NavigationService.ts:886-1008` |
| Path canonicalization and root containment | `NavigationService.ts:101-137`, `691-709` |
| Root/capability registration per session | `lib/navigation/rootRegistry.ts:32-75` |
| Size and binary guards | `NavigationService.ts:21-22`, `164` |
| Renderer-token boundary | `lib/navigation/rendererAuth.ts`, `api/canvas/decision/route.ts:37-48` |

### Gaps

- no resolver comparing arbitrary refs
- no snapshot store for review content
- no renderer-facing API to read snapshot content
- comments carry only session + path + single line (`lib/types.ts:10-16`)
- `resolveModelPath` realpaths the leaf, so it cannot validate a deleted file

## 3. Contract

### 3.1 Agent-facing tool

`present_changes` gains a selection mode. `scope: 'session'` keeps working
unchanged.

```jsonc
{
  "scope": "selection",
  "files": [
    { "path": "src/auth/session.ts", "reason": "Refresh-token rotation changed" }
  ],
  "baseRef": "origin/main",
  "title": "Review authentication changes",
  "summary": "Ready for review before integration"
}
```

| Field | Rule |
|---|---|
| `scope` | `session` or `selection`. Default `session`. |
| `files` | Required and non-empty when `scope = selection`; **forbidden** otherwise. 1–50 entries. |
| `files[].path` | Repository-relative POSIX path. No control characters. |
| `files[].reason` | Optional, ≤ 300 characters, plain text. |
| `baseRef` | Optional, **forbidden** when `scope = session`. ≤ 200 characters. |
| `title` / `summary` | Existing limits (200 / 1,000). |

The file cap is **50**, not 100: each entry can hold two content sides, so the
limit is a memory budget, not a UI budget (§4.3).

Duplicate paths collapse to the first occurrence. Paths that differ only by case
on a case-insensitive filesystem, or that resolve to the same filesystem
identity, are **rejected as ambiguous** rather than silently merged.

A path that is neither present in the working tree nor known to Git is rejected,
naming the offending path.

### 3.2 Typed request — discriminated, not optional

Model input and host output are separate types, so a model-shaped object can
never structurally carry status, counts, or provenance.

```ts
// MCP input only.
export interface ReviewFileInput {
  path: string;
  reason?: string;
}

// Host-authored output only.
export interface ReviewFileEntry {
  fileId: string;                 // opaque, snapshot-scoped
  path: string;                   // repository-relative POSIX
  reason?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'unchanged' | 'unavailable';
  previousPath?: string;          // when status = 'renamed'
  additions: number;
  deletions: number;
  contentAvailable: boolean;      // false for binary, oversized, sparse, or type change
  contentKind?: 'text' | 'gitlink';
  unavailableReason?: 'binary' | 'too_large' | 'submodule' | 'sparse' | 'type_changed';
}

export type BaseResolution =
  | 'explicit'
  | 'upstream-merge-base'
  | 'head-fallback'
  | 'unborn';

export interface ReviewSnapshotMeta {
  snapshotRef: string;
  branch: string | null;          // null when detached
  headSha: string | null;         // null when unborn
  requestedBaseRef: string | null;
  effectiveBaseSha: string | null;
  baseResolution: BaseResolution;
  isGitRepository: boolean;
  capturedAt: number;
}

export type ChangesCanvasPayload =
  | { scope: 'session' }
  | {
      scope: 'selection';
      files: ReviewFileEntry[];     // required
      snapshot: ReviewSnapshotMeta; // required
    };
```

`files` and `snapshot` are **required** in the selection variant. The renderer
can therefore never receive a half-formed selection request, and an incomplete
request must never fall through to transcript review.

### 3.3 Snapshot resolution

Per file, with **no fallback that hides a deletion**:

| Side | Rule |
|---|---|
| Original | `git cat-file` of the path at `effectiveBaseSha`; empty when absent from that tree |
| Current | Working-tree file when present; **empty when absent** |

`status` is derived from the two sides, never from "could we read HEAD":

- absent → present = `added`
- present → absent = `deleted`
- both present, bytes differ = `modified`
- both present, bytes equal = `unchanged` (still listed; the agent asked for it)

Base derivation:

1. explicit `baseRef` → resolved, or the request is **rejected** (`explicit`)
2. else `git merge-base @{upstream} HEAD` (`upstream-merge-base`)
3. else `HEAD` (`head-fallback`)
4. repository with no commits (`unborn`) → empty baselines, `headSha: null`

An explicit base that does not resolve is a **4xx error**, not a silent
downgrade. A typo in `origin/main` must not quietly become "uncommitted only".
Only automatic derivation may fall back, and the reason is always recorded and
surfaced.

### 3.4 Renderer API

```text
GET  /api/canvas/review/file?sessionId=<id>&fileId=<opaque>
  -> 200 { fileId, path, original, current, status, contentAvailable }
  -> 410 { error: { code: 'SNAPSHOT_EXPIRED' } }
```

- Requires the **renderer token**, matching `/api/canvas/decision`.
- Addressed by opaque `fileId`, so no repository path round-trips through a
  query string.
- Serves only files belonging to a live snapshot for that session.

Legacy `/api/sessions/changes` is untouched, so Dashboard V1, `ChangesViewer`,
revert, and transcript review keep working.

## 4. Rules

### 4.1 Trust boundary

- Session identity comes from the MCP capability, never from arguments.
- The repository root comes from `resolveRoot(sessionId)`.
- **The session may not supply a worktree path.** Its worktree is already
  authoritative and capability-bound; accepting a path would allow root escape.

### 4.2 Path validation for possibly-absent files

`resolveModelPath` realpaths the leaf and therefore cannot validate a deleted
file. Add a review-specific resolver that keeps containment guarantees:

1. Reject control characters, absolute paths, backslashes, drive letters, `..`.
2. Lexically normalize to a repository-relative POSIX path.
3. Realpath the **nearest existing ancestor** and assert containment, so no
   symlinked ancestor can escape the root.
4. `lstat` an existing leaf; do not dereference a symlink into another file.
5. Establish Git membership separately with literal, NUL-delimited plumbing.

### 4.3 Snapshot storage budget

Storing content is the main new memory risk: 50 files × 2 sides × 2 MB would be
200 MB if unbounded. Therefore:

- preflight sizes with `git cat-file -s` and `stat` **before** buffering
- per-file cap 2 MB (existing `MAX_FILE_BYTES`), per-snapshot cap 24 MB, global
  cap 96 MB
- exceeding a cap marks the entry `contentAvailable: false` rather than failing
  the whole review
- content is stored **content-addressed with reference counts**, so the two
  sides of an unchanged file and repeated captures share storage
- eviction is **LRU over snapshots that are not currently open, pinned, or
  queued**; an open review holds an opaque two-minute lease renewed every minute
- expired lease IDs are re-acquired once after sleep/timer throttling before the
  UI declares the snapshot expired
- snapshots are explicitly **process-lifetime only**. There is no 24-hour
  promise; after an app restart a reconnect renders the expired state.

### 4.4 Snapshot lifecycle

- The manifest is published **atomically after** capture succeeds and after the
  session/capability recheck, so a partially captured snapshot is never visible.
- Writes carry a **session generation token**; a capture that finishes after
  session removal is discarded instead of resurrecting orphaned content.
- Session end clears snapshots via `lib/state/sessionStore.ts:85-93`.
- `changes` already replaces prior retained requests server-side
  (`requestStore.ts:50-57`), but snapshot **content** is retained while any
  artifact referencing it is active, pinned, or queued.
- Extend `activateOrReplaceArtifact` so an active `changes` artifact is replaced
  in its history slot like Plan (`useContextCanvas.ts:220-256`), so repeated
  reviews do not stack history.

### 4.5 Git safety

`baseRef` is attacker-influenced:

- ≤ 200 characters, no control characters, must not begin with `-`
- resolved with `git rev-parse --verify --end-of-options <ref>^{commit}`
- **only the resolved object ID is used afterward**; the raw string never reaches
  another Git command
- all invocations use `spawn` with array arguments, `--literal-pathspecs`,
  `--end-of-options`, and `--` before paths
- `GIT_OPTIONAL_LOCKS=0` for read commands so review never fights `index.lock`
- explicit timeouts — the one hardening gap in today's transcript `execFile`
  calls (`lib/cli/transcript/index.ts:113-128`)
- batched plumbing (`ls-tree`, `cat-file --batch`, one `diff --name-status`)
  instead of per-file processes

### 4.6 Comment anchoring

Comments today are session + path + single line and are filtered by path only
(`SessionDiffCore.tsx:76-94`). Against a frozen snapshot that is misleading, so
anchors gain:

```ts
snapshotRef: string;
side: 'original' | 'current';
startLine: number;
endLine: number;
contentHash: string;      // frozen content the comment was written against
contextExcerpt: string;   // short surrounding text
```

Rules:

- decorations filter by `snapshotRef`, not just path
- when the working-tree hash no longer matches `contentHash`, the comment and
  the review are marked **stale**
- delivered review artifacts include frozen context and provenance, so the agent
  acting on a moved file can still locate the intended code
- "Open full file" either opens frozen content or states explicitly that it is
  switching to the newer live version

### 4.7 Git edge cases

| Case | Behavior |
|---|---|
| Rename | `status: 'renamed'` with `previousPath`, detected from `diff --name-status -M` |
| Submodule (gitlink) | `contentKind: 'gitlink'`; old/new commit IDs render as a frozen diff |
| File ↔ submodule type change | `unavailableReason: 'type_changed'`; no side is silently discarded |
| Detached HEAD | `branch: null`, base derivation continues |
| No upstream | `head-fallback`, surfaced in the header |
| Shallow clone, unreachable base | explicit base → error; derived base → `head-fallback` |
| Unborn HEAD | `baseResolution: 'unborn'`, empty baselines, still a Git repository |
| Sparse checkout `skip-worktree` | `unavailable`, not `deleted` |
| CRLF / `.gitattributes` | Compare normalized content so filters do not report every line changed; display raw |
| Worktree changes mid-capture | `stat` before and after each read, retry changed files, else fail with `WORKTREE_CHANGED_DURING_CAPTURE` |

### 4.8 When the agent should call it

Milestones, not keystrokes:

- a coherent change set is ready
- before requesting approval or completing a task
- when the user asks to review

Explicitly **not** after every file edit. Per-edit review produces half-finished
diffs and Canvas churn; retained replacement makes one later, complete call
strictly better than many partial ones.

### 4.9 Freshness is continuously visible

Capture-time provenance is not enough once the session keeps editing. On
`session:files-changed`, recompute hashes for affected files and show a
persistent "Working tree changed since this review was captured" state. Frozen
evidence is preserved; the user is never misled into thinking it is live.

## 5. Windows Filename Bug

### Root cause

`app/components/diff-core/ChangedFilesList.tsx:52`:

```ts
const name = f.path.split('/').pop() || f.path.split('\\').pop() || f.path;
```

For `C:\repo\src\auth.ts`, `split('/')` finds no separator and returns the whole
string as a single element. `.pop()` is therefore **truthy**, `||` short-circuits,
and the backslash fallback never runs. The full path renders as the file name.

Same class of bug, without even a fallback:

- `app/components/ChangesViewer.tsx:456` — `f.split('/').pop() || f`
- `app/components/ChangesViewer.tsx:379` — `repoRoot?.split('/').pop()`
- `app/components/diff-core/FileTree.tsx:16` — `file.split('/')` makes an entire
  Windows path a single tree node

The adjacent directory line is already separator-agnostic
(`f.path.replace(/[/\\][^/\\]+$/, '')`), which is why the symptom is "name shows
the path" rather than total failure.

### Fix

Add `lib/paths/displayPath.ts`:

```ts
export function toPosixPath(value: string): string;
export function baseName(value: string): string;   // separator-agnostic
export function parentPath(value: string): string;
```

Normalize separators **first**, then split. Apply in `ChangedFilesList`,
`ChangesViewer` (browse rows + root label), and `diff-core/FileTree`. Keep the
full path as a `title` tooltip so context is not lost.

`EditorTabs.tsx:20` and `editor/FileTree.tsx` share the pattern but are outside
review scope; convert opportunistically.

## 6. Implementation Plan

### Phase 1 — Path display fix (complete)

1. Add `lib/paths/displayPath.ts`.
2. Use it in `ChangedFilesList`, `ChangesViewer` browse rows and root label, and
   `diff-core/FileTree`.
3. Add `title={fullPath}` to name rows.
4. Verify POSIX, Windows, mixed-separator, drive-letter, UNC, and
   no-separator inputs.

No protocol change; fixes the reported bug immediately.

### Phase 2 — Backward-compatible vertical slice (complete)

The implementation landed as one backward-compatible slice. The public MCP
schema was exposed only after the renderer could serve it. Internal order:

1. **Contract types** — discriminated payload, host-authored entry/meta types,
   comment-anchor extension.
2. **Git plumbing** — `lib/review/git.ts`: ref resolution, batched tree/blob
   reads, rename detection, size preflight, timeouts, `GIT_OPTIONAL_LOCKS=0`.
3. **Path resolver** — `lib/review/paths.ts` implementing §4.2.
4. **Snapshot service + store** — `lib/review/snapshot.ts`,
   `lib/review/snapshotStore.ts`: capture, content-addressed storage, budgets,
   leases, generation tokens, atomic publish.
5. **Request integration** — `lib/canvas/requests.ts` selection branch calling
   the snapshot service; `ARG_KEYS.changes` extension.
6. **Renderer API** — `app/api/canvas/review/file/route.ts`, renderer-token
   gated, with `410 SNAPSHOT_EXPIRED`.
7. **UI data source** — `SessionDiffCore` gains optional `files` and
   `loadDiff(fileId)` props; absent both, behavior is unchanged. `DiffCanvas`
   supplies snapshot-backed data, provenance header, per-file `reason`, stale
   and expired states. Revert stays disabled for snapshot review.
8. **State** — extend `activateOrReplaceArtifact` to cover `changes`.
9. **Comments** — snapshot-scoped anchors, stale detection, enriched delivery.
10. **MCP exposure last** — `present_changes` schema, instruction updates,
    server version `1.6.0`.

### Phase 3 — Documentation (complete)

Update `repository-flow-map.md`, `dashboard-v2.md`,
`context-canvas-components.md`, and the handoff once behavior is verified.

## 7. Validation

**Protocol**

- selection accepted; `session` scope unchanged
- `files` with `scope: 'session'` rejected; `baseRef` with `session` rejected
- unknown fields, absolute paths, backslashes, `..`, drive letters, control
  characters rejected
- `baseRef` injection attempts (`--upload-pack=...`, `-`, `;`, backticks) rejected
- unresolvable **explicit** base rejected; derived fallback recorded, not silent
- 0 files rejected; 50 accepted; 51 rejected
- case-only duplicate paths rejected as ambiguous

**Snapshot**

- added / modified / deleted / renamed / unchanged / unavailable
- untracked, unborn repo, non-git root, submodule, sparse `skip-worktree`
- binary, > 2 MB, per-snapshot and global budget exhaustion
- CRLF repository does not report every line changed
- content stable after the agent edits the file post-capture
- worktree change during capture is retried or reported
- capture finishing after session end is discarded

**State**

- re-review replaces active artifact and history slot without growth
- background, pinned, human-owned, close-watermark, reconnect behavior
- open review holds a lease; eviction elsewhere does not blank it
- expired snapshot renders the expired state, not an empty diff

**UI**

- Windows, POSIX, and mixed separators show base names only
- full path available on hover
- provenance header shows branch, base, resolution reason, capture time
- stale banner appears after `session:files-changed`
- terminal keeps focus on arrival

**Build**

- `npx tsc --noEmit`, `npm run build`, live MCP call against a real session

## 8. Non-Goals

- No model-supplied diff content.
- No session-supplied worktree paths.
- No removal of transcript review or `/api/sessions/changes`.
- No per-edit auto-review.
- No revert/staging from the snapshot surface.
- No new diff renderer; `SessionDiffCore` and Monaco stay as-is.
- No cross-restart snapshot persistence in V1.

## 9. Implementation Evidence

- Git fixture probe passes modified, deleted, exact-renamed, untracked, sparse,
  added gitlink, file-to-submodule type change, frozen-content, invalid-base,
  traversal, lease, stale-status, route, cleanup, original-side feedback, and
  snapshot/legacy comment-isolation cases.
- Strict live API matrix passes eight invalid scope/path/base cases.
- Canvas reducer probe proves direct, queued, and restored reviews replace one
  history slot while developer-owned content remains protected.
- Fresh MCP server `1.6.0` accepts `scope: "selection"` and reports
  `canvas_renderer`.
- Live Canvas inspection confirms filename-only rows, reasons, two-file count,
  frozen diff content, non-Git provenance, and no Revert controls.
- TypeScript, MCP syntax, preload, and production build pass.
