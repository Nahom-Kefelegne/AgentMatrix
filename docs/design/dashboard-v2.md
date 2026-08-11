# Dashboard V2 - Console-First Control Center

Status: **Dashboard V2 with Code, Locations, Decision, and Changes Canvas components implemented**

Implementation plan:
[`../plans/dashboard-v2-context-canvas.md`](../plans/dashboard-v2-context-canvas.md)

## 1. Purpose

Dashboard V2 is AgentMatrix's primary developer workspace. It replaces the
equal-weight session card grid with a console-first command center:

- Route human attention.
- Keep the selected CLI immediately interactive.
- Make healthy sessions visible without encouraging babysitting.
- Reveal code and diffs in the session's conversational context.

The page's single job is:

> Show the developer the next decision, while keeping the selected agent's CLI
> and relevant repository context one action away.

## 2. Design Principles

### 2.1 The CLI is the product surface

Copilot and Claude remain real CLI applications running through PTYs. Dashboard
V2 does not hide them behind summaries. The live terminal receives the largest
area and owns all ordinary keyboard input.

### 2.2 Attention is ranked, not tiled

Every session remains in one list. Sessions needing a decision, review, context
reset, or intervention sort first and receive stronger semantic treatment.

### 2.3 Repository context belongs to the conversation

The Context Canvas is scoped to one selected session. Code, verified locations,
decisions, and diffs open because of a developer or session request and retain
a link back to the originating conversation event.

### 2.4 Structure carries meaning

The interface uses:

- A command rail for global app actions.
- A unified session list with priority styling.
- A terminal workspace for execution.
- A Context Canvas for temporary repository evidence.

These boundaries encode workflow rather than decorating a card layout.

### 2.5 Static by default

Continuous animation is avoided. This improves focus and keeps the dashboard
usable over Remote Desktop, where every animated frame must be streamed.

## 3. Visual Direction

Dashboard V2 is an instrument panel rather than a floating glass-card page.

### Palette

| Token | Hex | Use |
|-------|-----|-----|
| Instrument | `#0c0c18` | Terminal and dark workspace |
| Operational violet | `#8b5cf6` | Selection and review |
| Healthy green | `#34d399` | Connected and unblocked |
| Intervention amber | `#f59e0b` | Warning and possible stall |
| Critical red | `#ef4444` | Human decision and failure |
| Telemetry zinc | `#a1a1aa` | Metadata and secondary copy |

Light and dark surfaces inherit the app's existing OKLCH theme tokens.

### Typography

- Geist: interface copy and hierarchy.
- `ui-monospace`: paths, timestamps, context, deltas, IDs, terminal metadata,
  and provenance.

### Signature

The attention signal spine routes selected work into the session workspace.
The future Context Canvas extends that signal into an exact code range or diff
hunk, creating a visible Conversation -> Evidence relationship.

## 4. Full-Viewport Layout

Dashboard V2 fills the complete Electron renderer. It does not sit inside a
centered floating frame.

```text
+-----------------------------------------------------------------------+
| AgentMatrix | Dashboard Office | New Resume Tasks | theme hooks prefs |
+-----------------------------------------------------------------------+
| Sessions    | Selected session workspace                              |
|             | +----------------------+------------------------------+ |
| signals     | | Live CLI             | Context Canvas (conditional) | |
|             | |                      |                              | |
|             | +----------------------+------------------------------+ |
+-----------------------------------------------------------------------+
```

Desktop sizing:

- Command rail: 48px.
- Session list: approximately 200px.
- Workspace: all remaining height and width.

The terminal occupies the full workspace width while Canvas is closed.

## 5. Native Command Rail

Dashboard V2 does not use the legacy floating navigation pills because they:

- Consume overlay space.
- Cover dashboard content when the dashboard fills the viewport.
- Visually detach global actions from the workspace.

The integrated command rail contains:

### Left

- AgentMatrix mark.
- Connection state.
- Active session count.

### Center

- Dashboard.
- Office.
- Editor, only when unlocked.

### Right

- New.
- Resume.
- Tasks.
- Theme.
- Hook configuration.
- Settings.

There is no separate Sessions action. The left session list is always available.

On narrow widths, labels collapse before icons. All icon-only controls retain
accessible names.

## 6. Unified Session List

The list is derived from `deriveDashboardModel().fleet` and ordered by urgency:

1. Approval request.
2. Human decision.
3. Critical context.
4. Ready to review.
5. Context warning.
6. Possible stall.

Normal working sessions enter possible-stall treatment after three minutes
without activity. A session whose last known event is context compaction gets a
ten-minute grace period because Copilot compacts silently and exposes no
dedicated completion hook. A new user prompt clears the stale compaction label.

Healthy working, idle, and completed sessions remain in the same list after the
prioritized entries. Interaction-required sessions stay red until real CLI
prompt/tool activity changes their status.

The list is deliberately narrow. Long reasons truncate, while the selected
session exposes the full reason in the workspace header.

## 7. Session Workspace

### Compact header

The terminal header contains only operational information:

- CLI provider.
- Session name and status.
- Working directory.
- Last activity.
- Subagent count.
- Context remaining.
- Current attention reason.

Actions:

- Session Inspector.
- Review Diff, when changes exist.
- Request Summary.
- Fullscreen Terminal.

### Session Inspector

The selected session opens a right-side `SessionInspector` drawer. The drawer
is pinned to the session ID that opened it; selecting or auto-routing another
session cannot retarget an already-open inspector, and session removal closes it.

The MVP has three sections:

- **Overview:** provider, status, context, subagents, changed-file count,
  working directory, session ID, timestamps, restart profile, and rename.
- **MCPs:** effective static and runtime-injected MCP configuration with source,
  scope, transport, executable name, and environment-variable names. Values,
  URLs, arguments, and credentials are never returned to the renderer.
- **Tasks:** app tasks whose `assignedTo` equals the inspected session, with a
  handoff to the full Task Board.

The drawer is a lazy chunk and its consolidated
`/api/sessions/inspector` request starts only when opened. It preserves the
Control Center focus trap and does not remount or resize the live terminal.

Copilot session names come from the provider's full `workspace.yaml` name.
AgentMatrix reconciles stale cache/auto-resume names to that authority. Rename
reports success only after Copilot metadata is written; Claude continues to use
its native `/rename` command plus the app cache.

### Terminal

`SessionConsole` selects:

- `CopilotTerminalPanel` for Copilot's native alt-screen TUI.
- `TerminalPanel` for Claude.

Fullscreen uses the existing `FullscreenTerminal` component. While fullscreen
owns PTY dimensions, the embedded terminal receives `visible={false}`. When
fullscreen closes, the embedded terminal refits and reclaims PTY sizing.

Session restart preserves the launch profile and terminal dimensions. The
existing xterm resets before replacement output, and Windows receives explicit
process-tree/lock cleanup plus a longer startup-readiness window.

### Keyboard ownership

The dashboard does not implement global single-key shortcuts while the terminal
is active. xterm and the CLI own normal input. Global app shortcuts must ignore
terminal and editable targets.

## 8. Context Canvas

The Canvas is a conditional session-scoped companion to the terminal.

### Capabilities

- Open file at an exact line/range.
- Render Markdown documents with a lazy Preview/Source toggle.
- Auto-preview selected-session `docs/design/*.md` changes without stealing focus.
- Present grouped, exact repository locations already verified by the session.
- Present a blocking structured decision and deliver one answer to the owning session.
- Open stack-trace and compiler-error locations.
- Review This Turn, This Session, Working Tree, Branch/Worktree, and Checkpoint
  diffs.
- Select code/diff lines and send structured feedback to the owning session.
- Navigate Back/Forward and Back to Conversation.

### Presentation

- Closed by default.
- Opens without moving keyboard focus from the terminal.
- Resizable desktop split.
- Bottom drawer on smaller screens.
- Can be pinned.
- Pinned or edited content cannot be replaced by agent navigation.

### Monaco reuse

The Canvas reuses `@monaco-editor/react`:

- `Editor` for read-only code preview.
- `DiffEditor` through an extracted shared `DiffCore`.
- Existing AgentMatrix Monaco theme and language detection.

Monaco is dynamically imported only after the Canvas opens.

## 9. Navigation Sources

### Developer-controlled

- Clickable terminal file links.
- Stack traces and diagnostics.
- Manual Open File/Range.
- Review buttons.

### Session-controlled

Local AgentMatrix MCP tools:

- `open_file`.
- `reveal_range`.
- `present_code`.
- `present_locations`.
- `request_decision`.
- `open_diff`.
- `open_review`.

The tools navigate UI only. They cannot write files, execute commands, run Git,
or create terminals. Decision is the narrow exception: after explicit human
submission, AgentMatrix writes one validated response into the originating
session's existing PTY.

Repository and symbol search are intentionally disabled. Sessions investigate
with their normal coding tools and may present exact verified locations instead.

## 10. Focus Policy

Agent navigation preference:

| Mode | Result |
|------|--------|
| Disabled | Suppress session-initiated opens. |
| Queue | Add a suggestion chip. |
| Preview | Open without focus. Default. |
| Follow | Follow selected-session activity unless Canvas is pinned. |

Rules:

- Only the selected session may auto-preview.
- Agent progress queues by default.
- An explicit developer request may preview.
- Never replace pinned content or an active comment.
- Never request OS focus.
- Store navigation metadata, not source content, in telemetry.

## 11. Diff Provenance

The UI never shows an ambiguous "diff." Every review declares:

- Source.
- Base.
- Compare target.
- Worktree.
- Capture time.
- Freshness.
- Attribution confidence.

Sources:

- This Turn.
- This Session.
- Working Tree.
- Branch/Worktree.
- Checkpoint.

This distinction prevents transcript patches from being mistaken for the full
working-tree state.

## 12. Review Feedback

Review comments are structured session messages containing:

- Repository-relative path.
- Old/new side.
- 1-based range.
- Snapshot or patch reference.
- File hash.
- Developer comment.

AgentMatrix verifies freshness before delivery. Stale anchors require the
developer to re-anchor, send original context, or cancel.

## 13. Security Boundary

The renderer does not decide whether a path is safe.

Server/main-process responsibilities:

- Register repository/worktree roots.
- Issue session-bound capability tokens.
- Canonicalize paths.
- Resolve symlinks.
- Confirm the real target remains inside the allowed root.
- Handle Windows drive, UNC, WSL, case-insensitive, and network roots.
- Prevent cross-session root access.

Model-facing paths are repository-relative POSIX paths only.

## 14. Performance and RDP

- No infinite dashboard animation.
- V2 and Context Canvas remain lazy chunks.
- Monaco loads only after the Canvas opens.
- Full diff content loads only after selection.
- Requests use cancellation and stale-response protection.
- Git operations, transcript parsing, and canonical path checks never run
  synchronously in the renderer.
- Repository and symbol search perform no work while disabled; the retained
  compatibility route and navigation actions return HTTP 410.
- File size, result count, binary/generated folders, and traversal depth are
  capped before work starts.
- Terminal input, output, and resize handling always take priority over Canvas
  search/index work.
- Search and large review lists use virtualization.
- Terminal components do not subscribe to Canvas-only state.
- CSS grid/flex owns layout; no resize loop performs repeated DOM reads.

## 15. Feature Flag and Rollback

Dashboard V2 is the effective default.

Precedence:

1. `?dashboardV2=1|0`.
2. Explicit current-version persisted `settings.dashboardV2`.
3. Default `true`.

Legacy unversioned dashboard preferences migrate to the current default once.
Choosing Dashboard V1 afterward writes the current preference version and
continues to persist normally.

Dashboard V1 remains unchanged and independently renderable.

## 16. Component Map

```text
OfficeView
  DashboardV2Container
    DashboardV2
      DashboardV2Nav
      SessionSidebar
      SessionWorkspaceController
        EmbeddedSessionConsole
        SessionInspector (on demand)
        ContextCanvas
          CanvasToolbar
          CodePreview
          LocationsArtifact
          DecisionArtifact
          DiffWorkspace / DiffCore
          ReviewFeedbackComposer
    FullscreenTerminal (on demand)
    ChangesViewer compatibility wrapper (shared DiffCore)
```

## 17. Integration with Existing Code

### Monaco

- `CodePreview` reuses `lib/monacoTheme.ts` and dynamically loads a read-only
  Monaco editor without inheriting `EditorView` tabs/save/auto-focus behavior.
- Language detection currently comes from the root-scoped NavigationService;
  the older editor surfaces still retain their existing helpers.

### Diffs

- Keep `lib/cli/transcript/` and `/api/sessions/changes` as the session-diff
  source.
- `SessionDiffCore` is extracted from `ChangesViewer` and renders both embedded
  in Canvas and inside the compatibility modal.
- Comments, live refresh, inline/split mode and revert remain shared.
- Feedback currently uses the existing review artifact + session instruction
  pipeline; typed snapshot/hash anchors remain a follow-up.

### Terminal links

- A shared terminal-link provider is registered through `useXterm` for Copilot
  and through the same registrar in the legacy Claude lifecycle.
- It matches visible xterm lines only and validates file targets asynchronously.

### MCP

- `mcp-server/index.mjs` exposes status plus six read-only navigation/review tools.
- Every request is bound to one session capability and registered root.
- Claude uses an inheriting user-level definition. Copilot receives a
  session-bound `--additional-mcp-config`, so unmanaged sessions never see an
  AgentMatrix server without valid credentials.
- The Copilot definition uses `deferTools: "never"` so these eight control tools
  stay available even when its global deferred-tool search is active.
- Every managed new/resumed session receives the usage contract automatically:
  Claude through `--append-system-prompt`, Copilot through the AgentMatrix MCP
  server's model-facing initialization instructions.

### Security

The current editor/browse/Git routes are developer-facing and accept supplied
paths; they are not an agent security boundary. Navigation tools use a separate
read-only NavigationService with canonical root validation.

## 18. Current and Planned Status

Implemented:

- Dashboard V2 flag and V1 rollback.
- Attention model.
- Embedded live CLI.
- Unified session list with persistent attention treatment.
- Lazy review summary and ChangesViewer.
- Fullscreen reuse.
- V2-native command rail and full-viewport layout.
- Context Canvas split, resize, pinning, queued opens and per-session history.
- Lazy Monaco code/range preview.
- Grouped verified locations with lightweight snippets and Monaco handoff.
- Structured decisions with authenticated, idempotent PTY response delivery.
- Session Inspector with runtime MCP provenance, assigned tasks, launch profile,
  and provider-authoritative rename.
- Shared embedded DiffCore and compatibility ChangesViewer.
- Terminal file/stack/OSC-8/HTTP links.
- Capability-bound MCP navigation tools and root-scoped NavigationService.

Planned:

- Overlap/worktree coordination.
- Additional diff provenance sources (turn, working tree, branch/worktree,
  checkpoint) and snapshot/hash-backed stale anchors.
