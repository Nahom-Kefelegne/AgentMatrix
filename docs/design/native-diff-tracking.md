# Native Transcript-Based Change Tracking

Status: **implemented** (2026-07-11) · Supersedes the git-diff-based ChangesViewer backend.

## Problem

The "View Changes" feature was "barely working". Root causes (audited from code):

1. **File tracking was silently dead for Copilot.** The `tool-use` hook recorded
   edits from `tool_input.file_path`, but Copilot's Write/Edit payloads use
   `tool_input.path` (verified against live hook payloads). So `session.filesModified`
   never populated for Copilot → the viewer showed nothing. This broke the moment
   Copilot became the primary CLI.
2. **Diffs were computed against `git HEAD`, not a per-session baseline.** It showed
   *all* uncommitted repo changes vs the last commit — not what *this session* did.
   Pre-existing edits, other sessions' work, or a mid-session commit all corrupted
   the view. No snapshot was taken at session start.
3. **Git-only.** Non-git working directories degraded to empty/heuristic results.
4. **No live refresh** — loaded once on mount; new edits didn't appear until reopened.
5. Only `Write`/`Edit` were tracked (missed `create`/`apply_patch`/`MultiEdit`), no
   rename detection, staged/unstaged conflated.

## Key insight

Each CLI already writes an authoritative, per-session record of every tool call —
including the exact file edits — to disk:

- **Copilot:** `~/.copilot/session-state/<id>/events.jsonl`
- **Claude:** `~/.claude/projects/<project>/<id>.jsonl`

Reading that transcript is strictly better than reconstructing changes from git +
hook state: it's **per-session-exact**, **git-independent**, **complete**, and
**survives restarts**. Verified payload shapes (from real transcripts):

| CLI | Event | File tools & args |
|-----|-------|-------------------|
| Copilot | `tool.execution_start` / `tool.execution_complete` (paired by `toolCallId`, `success` flag) | `create {path, file_text}`, `edit {path, old_str, new_str}`, `apply_patch "*** Begin Patch …"` |
| Claude | `tool_use` block in `assistant` msg + `tool_result` (`is_error`) in next `user` msg | `Write {file_path, content}`, `Edit {file_path, old_string, new_string, replace_all}`, `MultiEdit {file_path, edits[]}` |

## Architecture

```
                      ┌─ parseCopilot.ts ─┐
events.jsonl ────────▶│  (+ applyPatch)   │
<id>.jsonl ──────────▶│  parseClaude.ts   │──▶ FileOp[]  ──▶ index.ts
                      └───────────────────┘                    │
                                                               ▼
                                       group by path → reverseApply() baseline
                                                               │
                        GET /api/sessions/changes ◀────────────┤
                          list:  FileChange[]   single: FileDiff (original/current/isNew)
                                                               │
                                            ChangesViewer (Monaco DiffEditor)
```

### `lib/cli/transcript/`
- **`types.ts`** — `FileOp {path, kind: create|edit|delete, content?, oldStr?, newStr?, replaceAll?}`,
  `FileChange {path, status, additions, deletions}`, `FileDiff {file, original, current, isNew}`.
- **`parseCopilot.ts`** — parses `events.jsonl`; pass 1 collects failed `toolCallId`s from
  `tool.execution_complete.success === false`, pass 2 emits ops for successful `create`/`edit`/`apply_patch`.
- **`parseClaude.ts`** — parses `<id>.jsonl`; pass 1 collects failed `tool_use_id`s from
  `tool_result.is_error`, pass 2 emits ops for successful `Write`/`Edit`/`MultiEdit`.
- **`applyPatch.ts`** — parses Copilot's `*** Begin/Update/Add/Delete File` envelope into FileOps
  (Add→create, Delete→delete, Update hunks→edit ops with context-anchored old/new strings).
- **`diff.ts`** — LCS line-count for additions/deletions (common prefix/suffix trim + a cell cap
  so huge files fall back to a coarse magnitude estimate).
- **`index.ts`** — `getSessionFileChanges()` / `getSessionFileDiff()` / `getSessionTouchedPaths()`.

### Baseline reconstruction (the core idea)

To show "what this session changed", we need the file's **pre-session** content. We derive it by
**reverse-applying** the session's ops to the *current on-disk* content, newest → oldest:

- **Pure edit history** (file existed before) → perfectly recovers the baseline (undo each
  `edit` by replacing `newStr` back with `oldStr`).
- **Create-then-edits** → collapses to `''` at the `create` (the file was new → `isNew`).
- **Full overwrite of a pre-existing file** is inherently lossy (prior content isn't in the
  transcript) → falls back to `git show HEAD:<path>` when available, else best-effort.

This needs no git and is exactly scoped to the session.

### Provider method
`CliProvider.getTranscriptPath(sessionId)` — Copilot returns `session-state/<id>/events.jsonl`,
Claude scans `projects/*/` for `<id>.jsonl`.

### API — `app/api/sessions/changes/route.ts`
Response contract unchanged (drop-in for the existing ChangesViewer):
- `GET ?sessionId=` → `{ sessionId, sessionName, files: [{path, status, additions, deletions}], totalFiles }`
- `GET ?sessionId=&file=` → `{ file, original, current, isNew }`
- `POST {action}` — revert is now **native/git-free**: `revert-file`/`revert-all` rewrite the
  reconstructed baseline (or delete a session-created file); `clear-tracking` unchanged.

### Live refresh
`tool-complete` hook emits `session:files-changed` when a file tool finishes; `ChangesViewer`
subscribes and re-fetches the list + current diff. (The `tool-use` hook's `filesModified`
tracking was also fixed to read both `path` and `file_path` for other consumers.)

## Known limitations

- **Assumes current on-disk == session-end state.** Correct for the live/recent session you're
  viewing (the normal case). For an *old* session whose files were later changed by other
  sessions, reverse-apply degrades gracefully (unmatched edits no-op; git HEAD fallback).
- **Bash-driven changes** (`sed`, `mv`, redirects, codegen scripts) aren't `edit`/`create`
  events, so they aren't captured as diffs (neither was the old approach). Git-status could be
  layered as an optional supplement later.
- **`apply_patch`** hunk→edit conversion is best-effort (context-anchored); ~1% of ops.

## Files

- `lib/cli/transcript/{types,diff,applyPatch,parseCopilot,parseClaude,index}.ts` — the engine
- `lib/cli/CliProvider.ts`, `CopilotProvider.ts`, `ClaudeProvider.ts` — `getTranscriptPath`
- `app/api/sessions/changes/route.ts` — transcript-backed GET/POST
- `app/api/hooks/tool-use/route.ts` — `path`/`file_path` field fix
- `app/api/hooks/tool-complete/route.ts` — `session:files-changed` emit
- `app/components/ChangesViewer.tsx` — live-refresh subscription
- `lib/types.ts` — `session:files-changed` socket event
