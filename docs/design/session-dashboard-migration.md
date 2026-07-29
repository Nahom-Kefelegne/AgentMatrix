# Session dashboard migration

## Product goal

AgentMatrix should preserve the value developers get from the native CLI while
making parallel sessions easier to supervise and making CLI output visual,
interactive, and actionable in the same window. It should not become a second
IDE, task tracker, or provider configuration surface.

Use this test for every migrated feature:

1. Does it reduce context switching while working with a CLI session?
2. Is the graphical surface meaningfully better than terminal text?
3. Does it improve parallel-session awareness, trust, or recovery?
4. Can it remain quiet until relevant?
5. Is it duplicating functionality better owned by the CLI or an IDE?

## Decisions

### Keep as core

| Capability | Target surface |
| --- | --- |
| Session selection and routing | Persistent left session list; New, Resume, Task Board, and links select the embedded CLI |
| Rename | Compact session overflow/power menu |
| Restart and End | Session power control with confirmation and lifecycle feedback |
| Transfer Context | Reframe as **Continue in Fresh Session**, suggested as context fills |
| Work summary/current work | Compact Session Brief in Context Canvas |
| Recent actions | Short expandable timeline in Session Brief |
| Subagent details | Contextual team popover/Session Brief section |
| Code feedback | Comments on any code opened in Canvas, not only changed files |

### Keep, but reduce or relocate

| Capability | Decision |
| --- | --- |
| Tasks | Keep the global Task Board and one-click Sync to Session; do not recreate a per-session task-management tab |
| Session ID and full CWD | Keep as copy controls in secondary session details |
| MCP | Show connection/health status per session; move provider-aware configuration to global Settings |

### Drop or replace

| Capability | Decision |
| --- | --- |
| Fork Session | Drop for Copilot; Continue in Fresh Session replaces it |
| Memory Notes | Drop the Claude-only store; repository Markdown is the durable visible artifact |
| Session MCP Store | Drop the Claude-only per-session registry |
| Repository file tree/root picker | Drop IDE-style browsing; retain search, agent navigation, terminal links, and code comments |
| Orchestrator diagnostic modal | Remove with the persistent orchestrator or hide under developer diagnostics |
| Modal fullscreen and Previous/Next | Embedded fullscreen and the persistent session list replace them |

## Target layout

- **Left:** session routing and attention.
- **Center:** live native CLI.
- **Right Context Canvas:** code, Markdown, search, diff/review, or Session Brief.
- **Session power control:** Rename, Continue in Fresh Session, Restart, End, and copyable identifiers.
- **Global surfaces:** Task Board, setup, provider-aware MCP/settings.

## Migration sequence

1. Unify Dashboard V2 selection so New, Resume, Task Board, and session links no
   longer open `SessionDialog`.
2. Move lifecycle and identity actions into the dashboard.
3. Add Session Brief for summary, activity, team, and metadata.
4. Add Continue in Fresh Session and comments on opened code.
5. Make provider decisions for legacy-only features, then delete
   `SessionDialog`, dead `SidePanel`, and obsolete Claude-only APIs.

## Current implementation

The first migrated lifecycle surface is the **Session power** control in the
Dashboard V2 console header:

- Restart performs a clean provider-owned exit, preserves model, effort,
  permission mode, allowed tools, Copilot mode, name, CWD, and session ID, then
  resumes the same conversation.
- End performs the existing graceful transcript-flush flow and removes the
  session from the active list.
- Both actions require an explicit in-context confirmation and expose progress
  beside the live CLI.

Session routing is now unified for Dashboard V2:

- New and resumed sessions select the embedded Control Center CLI.
- Task Board links route back to the embedded session instead of opening
  `SessionDialog`.
- Dashboard V2 owns its selected-session state; Office and Dashboard V1 retain
  the legacy modal state only until their own migration/removal.
- The legacy Info button was removed from the Control Center header.

Active global dialogs now share the **Control Center modal system**:

- New Session
- Resume Session
- Settings
- Integration Status
- Task Board drawer and nested task dialogs
- Existing context handoff (future **Continue in Fresh Session**)

The shared shell owns portal rendering, focus trapping/restoration, background
isolation, responsive dialog/drawer behavior, reduced motion, and the same
signal-line/typography language as Dashboard V2.

Task functionality is intentionally unchanged in this phase. Its workflow is
provisional and must be replanned against the console-first product goal before
additional task features are added.
