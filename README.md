# Agent Matrix

A desktop app that turns Claude Code into a visual, manageable multi-session powerhouse. Watch your AI agents work in a pixel RPG office, manage them from a professional dashboard, transfer context between sessions, search across your entire session history, and orchestrate complex workflows — all without leaving the app.

**No API keys needed** — uses your installed Claude CLI directly.

## Quick Start

### Option 1: Setup script (recommended)

Clone the repo and run the setup script. It checks prerequisites, configures Claude hooks, installs dependencies, and launches the app.

**macOS / Linux:**
```bash
git clone https://github.com/Nahom-Kefelegne/AgentMatrix.git
cd AgentMatrix
./setup.sh
```

**Windows (PowerShell):**
```powershell
git clone https://github.com/Nahom-Kefelegne/AgentMatrix.git
cd AgentMatrix
.\setup.ps1
```

The script checks for: Node.js, npm, Claude CLI, git, and optionally Azure CLI (for ADO integration). It tells you what's missing and how to install it.

### Option 2: Claude skill

Copy `setup-skill/setup-agentmatrix.md` to `~/.claude/commands/` then run:
```bash
claude
> /setup-agentmatrix
```

### Option 3: Manual setup

```bash
git clone https://github.com/Nahom-Kefelegne/AgentMatrix.git
cd AgentMatrix
npm install
npx electron-rebuild -m . -o node-pty
npx electron .
```

Then configure hooks from the **Setup** button inside the app.

## Features

### Pixel RPG Office View
- **24 unique character sprites** — each Claude session is a character that walks to a desk
- **Working animation** with flashing laptop, idle animation with sleep emoji
- **Agent teams gather in meeting rooms** with chat bubbles showing what each agent is doing
- **Drag characters** to different spots, hover for live tool status
- **Fired animation** — end a session and watch the character pack up and walk out

### Professional Dashboard
- **Card grid** with session status, context usage bars, and work summaries
- **Filter** by status (Working / Idle / Meeting)
- **AI-generated work summaries** — Claude summarizes what each session has done in 3 bullet points
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
- **Hidden Claude session** that powers app-internal features
- **Deep Session Search** — describe what you worked on, the orchestrator searches all transcripts using grep and subagents in parallel
- **Persists across restarts** — same session, accumulated context
- **View-only terminal** in Settings — see what the orchestrator is doing
- **Auto-accepts trust prompts** on first run

### Task Management
- **App-level task board** — create tasks, assign them to sessions
- **Assign = stdin injection** — task instruction is sent directly to the session's CLI
- **Claude creates TodoWrite tasks** — tracked in the session's Tasks tab
- **Bidirectional sync** — when Claude marks a task complete, the app task board updates
- **Unassign** — removes the task from the session and reverts to pending

### Session Management
- **Session dialog** with tabs: Console, Tasks, Info, Settings
- **Context usage bar** — see how much context each session has used
- **Rename sessions** via CLI command injection
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
├── Prompt Injector (stdin → file-based capture)
│   ├── Summary generation
│   ├── Task assignment
│   ├── Context handoff
│   └── Deep search queries
├── Services
│   ├── SummaryService (AI work summaries)
│   ├── OrchestratorService (hidden Claude session)
│   └── HandoffService (context transfer)
├── Session Store (globalThis persistence)
└── System Tray (background mode)

Claude Code CLI
├── Hooks → HTTP POST → API Routes → Socket.io → Browser
└── PTY stdin/stdout ↔ xterm.js in browser
```

### Prompt Injection System

The app's killer feature is its **standardized prompt injection pipeline**:

1. App writes a prompt to the session's PTY stdin
2. Prompt tells Claude to write output to a session-specific temp file
3. App polls for the file, reads it, cleans up
4. Clean, structured output — no TUI parsing needed

This powers: work summaries, task assignment, context handoff, and deep search.

## App Cache Files

All stored in `~/.claude/`:

| File | Purpose |
|------|---------|
| `agentmatrix-names.json` | Session name cache |
| `agentmatrix-tasks.json` | App task store |
| `agentmatrix-active-sessions.json` | Auto-resume tracking |
| `agentmatrix-settings.json` | User preferences |
| `agentmatrix-orchestrator.json` | Orchestrator session ID |
| `agentmatrix-output-<id>.txt` | Temp files for prompt injection |
| `agentmatrix-handoff-<id>.md` | Context transfer documents |

## Requirements

- Node.js 18+
- Claude Code CLI installed and authenticated
- macOS or Linux (Windows via WSL)

## Credits

- Character sprites: [Evert/mdkieran on OpenGameArt](https://opengameart.org/content/tiny-characters-set) (CC0)
- Built with Next.js 16, Electron, Socket.io, xterm.js, node-pty, framer-motion
