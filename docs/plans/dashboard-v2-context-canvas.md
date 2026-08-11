# Dashboard V2 and Context Canvas - Implementation Plan

Status: **Context Canvas MVP implemented; parallel-coordination phases planned**

Related design: [`../design/dashboard-v2.md`](../design/dashboard-v2.md)

Current decision (2026-08-03): repository and symbol search are disabled.
Search controls and MCP tools were removed; stale API/navigation requests return
HTTP 410. The original search implementation details below remain as historical
context.

## 1. Objective

Turn Dashboard V2 into the primary developer workspace for supervising multiple
CLI coding agents:

1. The selected Copilot or Claude CLI owns the majority of the viewport.
2. One session list contains every session and prioritizes those needing human judgment.
4. A session-scoped Context Canvas reveals code, verified locations, and diffs
   without replacing the CLI or turning AgentMatrix into a generic IDE.
5. The selected session can safely ask AgentMatrix to reveal repository context.

Dashboard V1 remains available as a rollback path through Settings and
`?dashboardV2=0`.

## 2. Current Baseline

Dashboard V2 shipped in `b55bda0` with:

- Default-enabled feature flag with V1 fallback.
- Attention queue derived by `lib/dashboard/attentionQueue.ts`.
- Embedded `SessionConsole` as the central workspace.
- Unified left session list with attention/review priority.
- Lazy transcript change summaries.
- Dynamic `ChangesViewer` and `FullscreenTerminal`.
- V2-specific `mc-` CSS namespace.

The next increment first fixes viewport use and navigation, then adds the
Context Canvas in independently shippable phases.

## 3. Product Decisions

### 3.1 CLI remains primary

- The terminal is always mounted while its session is selected.
- Dashboard shortcuts never intercept terminal input.
- The Canvas is closed by default and appears only after an explicit developer
  action or an allowed session navigation request.
- Opening Canvas content does not steal terminal focus.

### 3.2 Canvas is a preview slot, not an IDE shell

The Canvas does not add a permanent Explorer, Git sidebar, or unbounded editor
tabs. It owns one visible artifact plus a session-scoped Back/Forward history.

Supported artifact types:

- Code file/range.
- Symbol resolution results.
- Repository search results.
- Session, turn, working-tree, branch/worktree, or checkpoint diff.
- Review feedback thread.

### 3.3 Session is the unit of attribution

All navigation and review state is scoped to:

- `sessionRef`.
- `repoRef`.
- `worktreeRef` when applicable.
- Originating message/tool event.
- Diff source and freshness.

Repository-wide views are explicit secondary modes.

### 3.4 Agent opens are safe and non-disruptive

Per-user/session modes:

| Mode | Behavior |
|------|----------|
| Disabled | Ignore agent navigation tools; developer-clicked links still work. |
| Queue | Show a navigation chip without opening the Canvas. |
| Preview | Open Canvas content without moving focus. Default. |
| Follow | Follow selected-session reads/edits unless content is pinned. |

Pinned content, unsaved edits, and active review comments are never replaced.

## 4. Target Layout

Desktop viewport budget:

```text
48px  Integrated command rail
rest  200px attention rail + selected-session workspace
```

```text
+-----------------------------------------------------------------------+
| AM | Dashboard Office | New Resume Tasks | theme hooks settings       |
+-----------------------------------------------------------------------+
| Session list | Session Workspace                                      |
|              | +--------------------+-------------------------------+ |
| session A    | | Live CLI           | Context Canvas (when open)    | |
| session B    | |                    | Code / Search / Diff / Review  | |
|              | |                    |                               | |
|              | +--------------------+-------------------------------+ |
+-----------------------------------------------------------------------+
```

When Canvas is closed, the terminal consumes the complete workspace width.
When Canvas opens, the default split is 62% terminal / 38% Canvas and is
resizable between 35% and 70% Canvas width.

Below 900px, Canvas becomes a bottom drawer. Below 640px, the session list
becomes a collapsible strip above the workspace.

## 5. Major Components

### 5.1 `DashboardV2Nav`

Responsibility:

- Integrated, non-floating command rail.
- View switch: Dashboard, Office, optional Editor.
- Actions: New, Resume, Tasks, theme, hook configuration, Settings.
- Connection and active-session count.
- No Sessions action; session selection lives in the dashboard itself.

Contract:

```ts
interface DashboardV2Navigation {
  connected: boolean;
  sessionCount: number;
  editorUnlocked: boolean;
  onViewChange(mode: 'dashboard' | 'office' | 'editor'): void;
  onNewSession(): void;
  onResume(): void;
  onTasks(): void;
  onSettings(): void;
  onSetup(): void;
}
```

### 5.2 `SessionSidebar`

Responsibility:

- Render every `LaneItem` from `deriveDashboardModel().fleet`.
- Sort attention/review/warning sessions first while retaining all healthy sessions.
- Remain approximately 200px wide on desktop.
- Select a session without opening the legacy modal.
- Show urgency, reason, and wait duration.

Future queue types:

- Navigation request awaiting developer choice.
- Review feedback awaiting response.
- Stale diff.
- Cross-session file overlap.

### 5.3 `SessionWorkspaceController`

Proposed file:

`app/components/dashboard-v2/workspace/SessionWorkspaceController.tsx`

Responsibility:

- Own selected session workspace state.
- Coordinate terminal visibility and fullscreen ownership.
- Own Canvas state and per-session navigation history.
- Apply focus policy.
- Route navigation requests and acknowledgements.
- Keep transport and side effects out of presentational components.

```ts
interface SessionWorkspaceState {
  selectedSessionId: string | null;
  terminalFullscreen: boolean;
  canvas: CanvasState;
  histories: Map<string, NavigationHistory>;
}

interface CanvasState {
  mode: 'closed' | 'code' | 'search' | 'diff' | 'review';
  disposition: 'preview' | 'pinned';
  target: CanvasTarget | null;
  requestRef?: string;
  origin?: NavigationOrigin;
  loading: boolean;
  error: CanvasError | null;
}
```

### 5.4 `EmbeddedSessionConsole`

Responsibility:

- Wrap the existing `SessionConsole`.
- Remain mounted across Canvas opens.
- Set `visible={false}` while `FullscreenTerminal` owns PTY sizing.
- Refit and restore focus only after explicit developer action.

No new terminal implementation is required.

### 5.5 `ContextCanvas`

Proposed directory:

```text
app/components/context-canvas/
  ContextCanvas.tsx
  CanvasToolbar.tsx
  CodePreview.tsx
  SearchResults.tsx
  DiffWorkspace.tsx
  ReviewFeedbackComposer.tsx
  NavigationHistoryControls.tsx
  canvasTypes.ts
```

Responsibility:

- Render one session-scoped artifact.
- Preserve terminal focus on preview.
- Support Pin, Close, Back, Forward, Open Full Editor, and Back to Conversation.
- Show provenance and freshness on every artifact.

### 5.6 `CodePreview`

Implementation:

- Reuse `@monaco-editor/react` `Editor`.
- Read-only by default.
- Dynamically imported only while Canvas code mode is open.
- Reuse `AGENT_MATRIX_THEME` and existing language detection.
- Reveal exact 1-based line/column ranges.
- Avoid a project-wide tab model.

### 5.7 `DiffCore`

Extract from `ChangesViewer`:

- File/hunk list.
- Monaco `DiffEditor`.
- Inline/split presentation.
- Context expansion and full-file transition.
- Review comments.
- Revert eligibility and freshness checks.

`ChangesViewer` becomes a modal wrapper around `DiffCore`; the Canvas renders the
same core inline.

### 5.8 `TerminalLinkBridge`

Responsibility:

- Register shared xterm link providers through `useXterm`.
- Recognize validated:
  - `path:line`.
  - `path:line:column`.
  - Stack-trace variants.
  - OSC 8 links.
  - Normal HTTP(S) URLs.
- Emit a developer-originated navigation request.

The bridge validates targets through the backend before showing them as file
links. URL links remain normal external links.

### 5.9 `NavigationService`

Server/main-process responsibility:

- Register session repository/worktree roots.
- Issue session-bound capability tokens.
- Validate and canonicalize targets.
- Resolve symbols/search results.
- Enforce navigation preferences.
- Publish renderer navigation events.

MCP is an adapter into this service, not the internal architecture.

All broad repository work runs outside the renderer main thread:

- File indexing.
- Content and symbol search.
- Git base/diff resolution.
- Transcript parsing.
- Path canonicalization and symlink checks.

The renderer only submits requests, receives progress/results, and renders
bounded result windows.

### 5.10 Current code extraction map

#### Monaco

Reuse:

- `lib/monacoTheme.ts` for the AgentMatrix theme.
- `/api/editor?action=read` as the initial file-content API shape.
- The lazy Monaco import pattern in
  `app/components/editor/MonacoWrapper.tsx`.

Extract:

- One language-detection helper into `lib/editor/language.ts`. Detection is
  currently duplicated in `app/api/editor/route.ts`, `ChangesViewer.tsx`, and
  `editor/GitPanel.tsx`.
- Shared read-only Monaco options into `lib/editor/monacoOptions.ts`.

Do not embed `EditorView` directly. It owns project root selection, writable
tabs, save commands, Git panels, editor terminal state, and global shortcuts.
`MonacoWrapper` also auto-focuses today; `CodePreview` must not.

#### Transcript diffs

Reuse:

- `lib/cli/transcript/types.ts`.
- `lib/cli/transcript/index.ts`.
- `/api/sessions/changes` list, file, and revert contracts.
- `session:files-changed` live invalidation.

Extract from `ChangesViewer.tsx`:

- File list.
- Diff editor pane.
- Review decoration/comment layer.
- Revert eligibility.

Do not carry forward:

- Fixed modal positioning.
- Repository browse/root-picker state.
- Current markdown-file + terminal-input feedback delivery.

#### Terminal links

The shared target is `lib/hooks/useXterm.ts`, which already owns Copilot's xterm
lifecycle. Before adding link providers, migrate the legacy `TerminalPanel` to
the same hook so both CLIs register one `createXtermLinkProviders` implementation.

Providers perform only small viewport-line matching. They never scan complete
scrollback or repositories on each PTY chunk.

#### MCP

The current `mcp-server/index.mjs` only exposes `request_attention` and
`work_complete`. It posts status to `/api/hooks/mcp-status` and does not use a
session capability token.

Navigation requires:

- Extend the local server with read-only navigation tools.
- Add session-bound environment/capability data during PTY launch.
- Keep Claude's existing MCP config writer.
- Add provider-owned Copilot MCP configuration; Copilot currently reports MCP
  prompt support as disabled in `CopilotProvider`.

#### Security

Do not expose the current editor APIs directly to agent tools. The existing
editor/browse/Git routes accept caller-supplied paths and roots and include
write/delete/rename operations. The NavigationService must introduce a separate
read-only, root-registered API before MCP tools are enabled.

## 6. Navigation Contracts

### 6.1 Common target

```ts
interface SourcePosition {
  line: number;   // 1-based
  column?: number; // 1-based
}

interface SourceRange {
  start: SourcePosition;
  end?: SourcePosition; // exclusive
}

interface CanvasTarget {
  repoRef: string;
  worktreeRef?: string;
  path: string; // repository-relative POSIX path only
  range?: SourceRange;
  symbol?: string;
}

interface NavigationOrigin {
  kind: 'developer_link' | 'explicit_user_request' | 'agent_progress';
  sessionRef: string;
  messageRef?: string;
  toolCallRef?: string;
  summary: string;
}
```

### 6.2 AgentMatrix MCP tools

MVP:

- `open_file`.
- `reveal_range`.
- `open_symbol`.

Phase 2:

- `show_search_results`.
- `open_diff`.
- `open_review`.

Example:

```json
{
  "protocolVersion": "agentmatrix.navigation/v1",
  "sessionRef": "am_session_123",
  "repoRef": "am_repo_456",
  "target": {
    "path": "src/auth/authorize.ts",
    "range": {
      "start": { "line": 42, "column": 1 },
      "end": { "line": 76, "column": 2 }
    }
  },
  "presentation": {
    "disposition": "preview",
    "focus": "preserve"
  },
  "intent": {
    "kind": "explicit_user_request",
    "summary": "Show the OAuth callback validator"
  }
}
```

### 6.3 Result contract

```ts
type NavigationStatus =
  | 'shown'
  | 'queued'
  | 'suppressed'
  | 'needs_user_choice'
  | 'rejected'
  | 'stale'
  | 'failed';

interface NavigationResult {
  requestRef: string;
  status: NavigationStatus;
  paneRef?: string;
  target?: CanvasTarget;
  focusApplied: 'preserve' | 'canvas';
  error?: {
    code: string;
    message: string;
    recovery?: string;
  };
}
```

## 7. Socket Events

Add typed events in `lib/types.ts`:

```text
navigation:requested
navigation:acknowledged
navigation:applied
navigation:failed
workspace:navigation-changed
session:diff-updated
review:feedback-created
review:feedback-delivered
review:feedback-resolved
session:overlap-detected
```

Every navigation event includes `requestRef` and `sessionRef`. Renderer code must
ignore events for an unselected session unless the request is queued.

## 8. Diff Provenance

Never display an unlabeled "Changes" view. Every diff declares:

| Source | Meaning |
|--------|---------|
| This Turn | File operations associated with one conversation turn. |
| This Session | Transcript-attributed changes for one managed session. |
| Working Tree | Current repository dirty state from all writers. |
| Branch/Worktree | Explicit Git base compared with a branch/worktree. |
| Checkpoint | Snapshot A compared with snapshot B. |

Required header metadata:

- Source.
- Base and compare target.
- Worktree.
- Captured timestamp.
- Freshness.
- Attribution confidence.

Confidence values:

- `tool_patch_verified`.
- `observed_during_session`.
- `working_tree_unattributed`.
- `stale`.

## 9. Structured Review Feedback

```ts
interface ReviewFeedback {
  feedbackRef: string;
  sessionRef: string;
  repoRef: string;
  anchor: {
    path: string;
    side: 'old' | 'new' | 'file';
    range: SourceRange;
    snapshot: {
      kind: 'session_patch' | 'working_tree' | 'branch' | 'checkpoint';
      snapshotRef: string;
      fileHash: string;
    };
  };
  body: string;
  delivery: 'steer_if_running_else_queue' | 'queue';
}
```

Before delivery:

- Recompute file hash.
- Mark stale anchors.
- Offer Re-anchor, Send Original Context, or Cancel.

Feedback enters the session through the existing app-owned instruction/capture
pipeline, not by simulating typed terminal input.

## 10. Security and Path Rules

Model-facing calls:

- Accept repository-relative POSIX paths only.
- Reject absolute paths, drive letters, UNC paths, `..`, NUL bytes, and
  encoded traversal.
- Resolve against a registered root.

Main process/server:

- Canonicalize with platform-aware filesystem APIs.
- Resolve symlinks and verify the real path remains under the allowed root.
- Treat Windows drive, UNC, WSL, and network mappings as registered root
  metadata, never model input.
- Bind capability tokens to one managed session and one root.
- Prevent one session from targeting another session's root.

Agent navigation tools are read-only UI capabilities. They cannot:

- Write files.
- Execute shell commands.
- Run Git operations.
- Create terminals.
- Focus the OS window.

## 11. Implementation Phases

### Phase 0 - Viewport and menu (implemented)

Files:

- `app/components/dashboard-v2/DashboardV2Nav.tsx`.
- `DashboardV2.tsx`.
- `DashboardV2Container.tsx`.
- `app/page.tsx`.
- `app/styles/mission-control.css`.

Deliver:

- V2-native command rail.
- Remove Sessions action.
- Edge-to-edge layout.
- 200px unified session list.
- Fullscreen button using existing `FullscreenTerminal`.

### Phase 1 - Manual Context Canvas MVP (implemented)

Deliver:

- Workspace split controller.
- Canvas shell, toolbar, pin/close/history.
- Lazy read-only Monaco `CodePreview`.
- Manual Open File/Range API.
- Terminal file/stack-trace links.
- Back to Conversation metadata.
- Preview/Queue/Disabled preference.

No MCP required to validate the interaction model.

### Phase 2 - Agent navigation tools and session review (implemented)

Deliver:

- Main-process/session capability service.
- `open_file`, `reveal_range`, `open_symbol`.
- Copilot and Claude local MCP registration.
- Navigation request/result events.
- Ambiguous symbol result picker.
- Audit trail.

Delivered:

- Root-scoped NavigationService and content APIs.
- MCP `open_file`, `reveal_range`, `open_symbol`, `show_search_results`,
  `open_diff`, and `open_review`.
- Clickable xterm file/stack/OSC-8/HTTP links.
- Shared embedded `SessionDiffCore`; legacy modal remains compatible.
- Inline comments, revert, live refresh, and feedback delivery to the owning
  session.
- Streamed, cancellable, bounded and cached repository/symbol search.

Remaining review-source expansion:

- This Turn, working-tree, branch/worktree, and checkpoint diff sources.
- Snapshot/hash-backed stale-anchor handling.

### Phase 3 - Parallel coordination

Deliver:

- Cross-session file and line overlap detection.
- Worktree-aware attribution.
- Base/Session A/Session B comparison.
- Handoff or ownership reassignment.
- Optional merge editor.

## 12. Refactoring Sequence

1. Keep the completed Phase 0 shell stable while Canvas work remains flagged.
2. Extract language detection and Monaco theme helpers without changing
   `EditorView` behavior.
3. Add Canvas shell with a placeholder artifact.
4. Add read-only `CodePreview`.
5. Add validated terminal links.
6. Add NavigationService and manual API.
7. Add MCP adapter.
8. Extract `DiffCore` behind compatibility tests.
9. Move Canvas review onto `DiffCore`.
10. Add structured feedback and overlap features.

At every stage, existing `ChangesViewer`, `EditorView`, and Dashboard V1 remain
functional rollback paths.

## 13. Performance Requirements

- Monaco is dynamically imported only after Canvas opens.
- Keep one Monaco instance per visible Canvas artifact.
- Abort stale file/search/diff requests when session or target changes.
- Cache file content by `{repoRef, path, mtime}`.
- Never scan repositories, execute Git, or parse transcripts synchronously in
  React render/effects or Electron's renderer thread.
- Execute code search through an async server/main-process service or worker.
- Build one bounded, reusable index per canonical repo/worktree root rather than
  walking the tree for every query.
- Cache normalized search results by `{root, indexVersion, query, mode, scope}`
  with TTL and LRU caps.
- Deduplicate identical in-flight searches.
- Debounce interactive query changes and cancel superseded work with
  `AbortController`/request tokens.
- Stream partial result batches so useful matches can render before the full
  search completes.
- Schedule index refreshes incrementally from file-change events or during idle
  time; never rebuild an entire index on every tool completion.
- Bound file size, result count, directory traversal, and binary/generated
  directories before search begins.
- Keep terminal input/output and resize processing higher priority than Canvas
  indexing or search result rendering.
- Virtualize search results and large diff file lists.
- Do not subscribe the terminal subtree to Canvas-only state.
- Canvas resizing uses CSS grid/flex, not per-frame JavaScript measurements.
- No continuous decorative animation, especially over RDP.

## 14. Validation Matrix

### Functional

- Select attention and healthy sessions from the same list.
- Switch terminal sessions while Canvas is open/closed/pinned.
- Open/close fullscreen and verify PTY resize ownership.
- Open exact file/range from terminal links.
- Back/Forward and Back to Conversation.
- Stale file, deleted file, ambiguous symbol, and invalid-root errors.
- V1 rollback through Settings and `?dashboardV2=0`.

### Platform

- macOS local.
- Windows local.
- Windows RDP.
- Network drive (`Q:\`-style root).
- UNC and case-insensitive path validation.

### Quality gates

- `npx tsc --noEmit`.
- `npm run build`.
- Web Interface Guidelines audit.
- Terminal focus and resize regression review.
- Screenshot at 1440x980, 1024x768, and 800px width.

## 15. Success Metrics

MVP:

- Median prompt-to-relevant-code time.
- File-link resolution success rate.
- Percentage of Canvas opens preserving terminal focus.
- Canvas dismiss-without-interaction rate.

Review:

- Median first-edit-to-first-reviewed-hunk time.
- Session review completion rate.
- Feedback comments resolved by the owning session.
- Full-file expansion rate.

Parallel work:

- Conflicting-write incidents.
- Overlap warnings acknowledged before conflicting edits.
- Worktree adoption for concurrent edit tasks.
