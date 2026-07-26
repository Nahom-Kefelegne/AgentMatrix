# Agent Matrix

A desktop app that turns CLI coding agents (GitHub Copilot CLI and Claude Code) into a visual, manageable multi-session powerhouse.

**No API keys needed** — uses your installed CLI binaries directly.

> **Note:** This is in early internal testing. We recommend trying it on your **devbox (Windows)** first rather than your primary machine, since the setup configures CLI hooks globally.

---

## Setup (One Command)

### Prerequisites

Make sure the following are installed and available on your PATH. **At least one
CLI agent** (GitHub Copilot CLI or Claude Code CLI) is required — Copilot is the
primary, recommended agent.

| Tool | Required | How to check |
|------|----------|-------------|
| **Node.js 18+** | Yes | `node -v` |
| **GitHub Copilot CLI** | Recommended primary (or Claude) | `copilot --version` |
| **Claude Code CLI** | Optional (or Copilot) | `claude --version` |
| **Git** | Yes | `git --version` |
| **Azure CLI** | Optional (ADO integration) | `az --version` |

### Install & Launch

Open a terminal in the directory where you want to install, then run:

**Windows (PowerShell) — recommended for testing:**
```powershell
Invoke-WebRequest https://raw.githubusercontent.com/Nahom-Kefelegne/AgentMatrix/main/setup.ps1 -OutFile setup.ps1; .\setup.ps1
```

**macOS / Linux:**
```bash
curl -sO https://raw.githubusercontent.com/Nahom-Kefelegne/AgentMatrix/main/setup.sh && bash setup.sh
```

The setup script will:
1. Verify prerequisites (Node, git, and at least one of Copilot/Claude)
2. Configure Claude Code hooks in `~/.claude/settings.json` and Copilot hooks in `~/.copilot/hooks/agentmatrix.json` when Copilot is detected
3. Clone this repo into an `AgentMatrix` folder
4. Install dependencies — resilient to blocked public-npm networks: it fails fast and re-resolves through the registry in your `.npmrc` (e.g. a corporate Azure Artifacts mirror)
5. Set up native modules (node-pty) — it verifies the shipped N-API prebuilt binary works under Electron and **skips the network-dependent `electron-rebuild`** unless the prebuilt genuinely can't spawn (in which case it tries a time-bounded rebuild)
6. Launch the app

### Run Again Later

From wherever you ran the setup command:

```powershell
# Windows
.\AgentMatrix\start.ps1
```

```bash
# macOS / Linux
./AgentMatrix/start.sh
```

The start scripts **fast-forward to the latest code from `main` before launching**
(a failed pull — offline, local edits, blocked network — is non-fatal and the app
still starts on the current version). If a pull changes dependencies, they'll tell
you to run the update script below to reinstall.

### Update

For a full update (pull + reinstall dependencies + refresh CLI hooks):

**Windows (PowerShell):**
```powershell
.\AgentMatrix\update.ps1
```

**macOS / Linux:**
```bash
bash AgentMatrix/update.sh
```

This pulls the latest code, reinstalls dependencies, and updates CLI hooks.

### Running over Remote Desktop (RDP)

The app is tuned for remote/RDP use. When it detects a Windows remote session it
automatically enables a **reduced-motion mode** that turns off continuous
background animations (which are expensive to stream over RDP) while keeping the
static ambient visuals — this makes the whole UI feel much snappier. No action
needed.

If you use a remote protocol that isn't auto-detected (Citrix, VNC, Parsec, …),
force it on from the app's DevTools console (Ctrl+Shift+I):

```js
localStorage.setItem('am-reduce-motion', '1'); location.reload();
```

Set it to `'0'` to force it off, or remove the key to return to auto-detect.

### Performance diagnostics (optional)

To capture performance telemetry in the app's terminal output, launch with
`AM_PERF=1`:

```powershell
# Windows
$env:AM_PERF = '1'; .\AgentMatrix\start.ps1
```
```bash
# macOS / Linux
AM_PERF=1 ./AgentMatrix/start.sh
```

Every ~3s the terminal logs `[perf:client]` (long tasks, FPS, component render
counts, socket/terminal throughput) and `[pty:perf]` (per-chunk processing cost)
lines. Everything is off by default — this only runs when `AM_PERF=1` is set.

---

## Features

### Pixel RPG Office View
- **24 unique character sprites** — each CLI session is a character that walks to a desk
- **Working animation** with flashing laptop, idle animation with sleep emoji
- **Agent teams gather in meeting rooms** with chat bubbles showing what each agent is doing
- **Drag characters** to different spots, hover for live tool status
- **Fired animation** — end a session and watch the character pack up and walk out

### Professional Dashboard
- **Mission Control is the default dashboard** — a prioritized attention queue surfaces only sessions that need a decision, review, context reset, or intervention
- **Embedded live CLI** — selecting a signal or quiet session switches the central workspace directly to that session's Copilot or Claude terminal
- **Full-viewport workspace** — an integrated command rail replaces the floating dashboard menu so the selected CLI receives the maximum available space
- **Fullscreen terminal** — expand the selected CLI into the existing multi-pane terminal workspace
- **Quiet telemetry rail** keeps healthy working/idle sessions visible without encouraging constant babysitting
- **Inline review actions** open transcript-native diffs without making the legacy session modal the primary workflow
- **Dashboard V1 remains available** from Settings → Interface; `?dashboardV2=0` temporarily forces V1 and `?dashboardV2=1` forces V2
- **AI-generated work summaries** — the session's CLI summarizes what it has done in 3 bullet points
- **One-click actions** — open any session's terminal, view tasks, or transfer context

### Interactive Terminal (Electron)
- **Built-in xterm.js terminal** for every session — no external terminal needed
- **Spawn new sessions** with name, working directory, permission mode, model, and effort level
- **Resume past sessions** by project, global search, session ID, or AI-powered deep search
- **Auto-resume** — sessions persist across app restarts
- **System tray** — runs in background

### Context Transfer (Handoff)
- **Transfer context between sessions** — select what knowledge to carry over
- **Source session generates the summary** (it has the full context, no transcript parsing needed)
- **New session reads and internalizes** the handoff document
- **Full session config** — pick model, permission mode, effort, and working directory for the new session
- **Progress tracking** — live status updates (Summarizing → Spawning → Injecting → Done)

### Orchestrator
- **Hidden Copilot orchestrator session** that powers app-internal features
- **Deep Session Search** — describe what you worked on, the orchestrator searches all transcripts using grep and subagents in parallel
- **Persists across restarts** — same session, accumulated context
- **View-only terminal** in Settings — see what the orchestrator is doing
- **Auto-accepts trust prompts** on first run

### Task Management
- **App-level task board** — create tasks, assign them to sessions
- **Assign = stdin injection** — task instruction is sent directly to the session's CLI
- **CLI task sync** — task details are injected into the assigned session
- **Bidirectional sync** — when the session marks a task complete, the app task board updates
- **Unassign** — removes the task from the session and reverts to pending

### Session Management
- **Session dialog** with tabs: Console, Tasks, Info, Settings
- **Context usage bar** — see how much context each session has used
- **Rename sessions** via provider-owned rename handling (Copilot updates `workspace.yaml`; Claude uses the legacy CLI path)
- **Memory notes** — view and add project memory
- **MCP server management** — browse, install, remove MCP servers
- **Copy resume command** — one-click CLI command to resume in external terminal

### Agent Teams
- **Agents appear as sprites** in meeting rooms while working
- **Walk out** when the parent session ends them
- **Click agent → opens parent session** dialog
- **Real-time tool activity** shown via chat bubbles

### Deep Session Search
- **AI-powered search** across all session transcripts
- **Orchestrator uses grep + parallel subagents** for fast searching
- **Results show as resumable sessions** with Resume in App or Copy Command
- **Search by work description** — "find sessions where I worked on auth"

## Architecture

```
Electron Main Process
├── Next.js Server (API routes + static)
├── Socket.io Server (real-time events)
├── PTY Manager (terminal sessions via node-pty)
│   ├── User sessions (interactive terminals)
│   └── Orchestrator (hidden, app-internal)
├── ACP / Prompt Capture (Copilot ACP, Claude stdin → file fallback)
│   ├── Summary generation
│   ├── Task assignment
│   ├── Context handoff
│   └── Deep search queries
├── Services
│   ├── SummaryService (AI work summaries)
│   ├── OrchestratorService (hidden Copilot session)
│   └── HandoffService (context transfer)
├── Session Store (globalThis persistence)
└── System Tray (background mode)

CLI Agents (GitHub Copilot CLI / Claude Code)
├── Hooks → HTTP POST → API Routes → Socket.io → Browser
└── PTY stdin/stdout ↔ xterm.js in browser
```

### Prompt Injection System

The app's killer feature is its **standardized prompt injection pipeline**:

1. App submits an out-of-band instruction for the session
2. Copilot sessions use ACP capture when available; Claude falls back to a file-writing PTY prompt
3. App reads the captured output and cleans up any temporary file
4. Clean, structured output — no TUI parsing needed

This powers: work summaries, task assignment, context handoff, and deep search.

## App Cache Files

All Agent Matrix-owned state is stored in `~/.agentmatrix/`:

| File | Purpose |
|------|---------|
| `names.json` | Session name cache |
| `tasks.json` | App task store |
| `active-sessions.json` | Auto-resume tracking |
| `settings.json` | User preferences |
| `orchestrator.json` | Orchestrator session ID |
| `output/<id>.txt` | Temp files for Claude prompt-injection fallback |
| `handoffs/<id>.md` | Context transfer documents |

## Requirements

- Node.js 18+
- GitHub Copilot CLI installed and authenticated (primary), with Claude Code CLI still supported
- Windows, macOS, or Linux

## Credits

- Character sprites: [Evert/mdkieran on OpenGameArt](https://opengameart.org/content/tiny-characters-set) (CC0)
- Built with Next.js 16, Electron, Socket.io, xterm.js, node-pty, framer-motion
