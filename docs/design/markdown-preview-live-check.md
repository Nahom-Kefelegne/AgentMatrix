# AgentMatrix Tooling Showcase

AgentMatrix turns a managed Copilot or Claude session into a live Control Center
workflow. The agent can report status, reveal repository context, and hand work
back for review without taking control of the terminal.

## The eight session tools

| Tool | What it does | What you should see |
| --- | --- | --- |
| `request_attention` | Marks the session as needing a human decision | The session stays red and prioritized until you respond |
| `work_complete` | Marks the requested work complete | Completion state and summary appear in the session list |
| `open_file` | Opens an exact repository file | Code uses Monaco; Markdown uses this rendered document view |
| `reveal_range` | Opens an exact line and column range | Canvas highlights the relevant source instead of the whole file |
| `open_symbol` | Finds a named function, type, or class | Symbol results lead to the owning definition |
| `show_search_results` | Streams repository matches | Multiple locations appear without blocking terminal input |
| `open_diff` | Opens the session-attributed diff | Only changes attributed to this session are shown |
| `open_review` | Opens the review workflow | Line comments can be returned to the owning session |

## 1. Status routing

```text
agent working
    ↓
needs a decision ── request_attention ──→ red attention queue
    ↓
work verified ───── work_complete ──────→ complete
```

- [x] The agent stays **working** throughout its turn.
- [x] Tool completion does not incorrectly make the session idle.
- [x] Attention and completion remain sticky until a real state transition.

## 2. File and range navigation

```ts
open_file({
  path: 'app/components/context-canvas/MarkdownPreview.tsx'
});

reveal_range({
  path: 'app/components/context-canvas/useContextCanvas.ts',
  startLine: 188,
  endLine: 257
});
```

Repository paths are root-scoped and validated against traversal and symlink
escapes. Agent-opened previews preserve terminal focus.

## 3. Symbol and repository search

Use `open_symbol` when the exact code element is known:

```ts
open_symbol({
  symbol: 'useContextCanvas',
  symbolKind: 'function'
});
```

Use `show_search_results` when several locations may matter:

```ts
show_search_results({
  query: 'invalidateNavigationFileEvent',
  mode: 'content'
});
```

Search streams asynchronously so the CLI remains interactive.

## 4. Rendered Markdown documents

Markdown opens in **Preview** by default and keeps **Source** one click away.

- [x] GitHub-flavored tables and task lists
- [x] Escaped code blocks
- [x] Root-validated relative document links
- [x] Sanitized output with raw HTML and images disabled
- [x] Automatic preview after successful `docs/design/*.md` edits
- [x] Large-file confirmation above 512 KB

> Design documents stay inside the conversation instead of sending you to a
> separate editor.

Read the full [Markdown integration contract](./context-canvas-markdown.md).

## 5. Pin, history, and queue protection

| Current Canvas state | Incoming session artifact |
| --- | --- |
| Closed | Opens as a preview |
| Existing automatic preview | Replaces after the quiet period |
| Same document | Refreshes in place |
| Developer-opened code | Queues |
| Pinned artifact | Queues |
| Background session | Queues, then opens when that session is selected |

Back and Forward preserve per-session history. **Back to Conversation** closes
Canvas and returns keyboard focus to the live terminal.

## 6. Session diff and review

`open_diff` and `open_review` use transcript-native attribution:

```text
This Session
  ├─ changed files
  ├─ exact additions and deletions
  ├─ line comments
  └─ Discuss / Ask session to fix
```

This avoids mixing another agent's edits or unrelated developer work into the
review surface.

## 7. Terminal links and clipboard behavior

- File paths, stack traces, OSC-8 links, and HTTP links are clickable.
- HTTP links use the operating system browser policy.
- Repository links open in the owning session's Canvas.
- Copilot's repeated right-edge timeline rail is removed from copied multiline
  text without stripping legitimate Markdown table or code pipes.

## 8. Cross-platform reliability

| Area | macOS / Linux | Windows |
| --- | --- | --- |
| Terminal renderer | WebGL, then Canvas fallback | DOM renderer for ClearType and RDP |
| Fonts | Menlo / Monaco fallback | Cascadia Mono / Consolas fallback |
| Hooks | Fail-open Bash transport | Fail-open PowerShell transport |
| Dependencies | Microsoft package feeds | Microsoft package feeds |
| Restart | Stops the owned port-3000 process | Requires fully quitting the tray app |

The start and update scripts verify `node_modules` against the current lockfile
before launch, so newly added renderer packages cannot silently remain missing.
