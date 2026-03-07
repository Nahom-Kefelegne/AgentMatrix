# Agent Matrix

A pixel RPG-style office that visualizes your active Claude Code sessions in real time. Each session appears as a character that walks to a desk, shows working/idle animations, and displays what tools are being used. Agent teams gather in meeting rooms with chat bubbles. Manage tasks, MCP servers, memory notes, and more — all from the browser.

## How It Works

Agent Matrix connects to your Claude Code sessions through 3 layers:

1. **Process Scanner** — Every 10 seconds, scans running processes (`ps aux`) to discover active Claude Code sessions. No configuration needed — sessions appear automatically.

2. **Claude Code Hooks** — Optional but recommended. Hooks in `~/.claude/settings.json` send real-time events (tool usage, agent spawns, session stops) to the web app via HTTP. This enables live status updates, chat bubbles, and working animations.

3. **Socket.io** — Pushes all events from the server to your browser via WebSocket for instant UI updates.

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/Nahom-Kefelegne/AgentMatrix.git
cd AgentMatrix
npm install
```

### Automated setup with Claude

Once cloned, you can have Claude set everything up for you:

```bash
cd AgentMatrix
claude
# Then ask: "Read the README and set up Agent Matrix for my environment"
```

Claude will read the README, configure the hooks in your settings, and get everything running.

### 2. Configure Claude Code hooks

Add the following `hooks` section to your `~/.claude/settings.json`. If you already have settings in this file, merge the `hooks` key into your existing config — don't replace the whole file.

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "cat | curl -s -X POST http://localhost:3000/api/hooks/session-start -H 'Content-Type: application/json' -d @-"
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "cat | curl -s -X POST http://localhost:3000/api/hooks/session-end -H 'Content-Type: application/json' -d @-"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "cat | curl -s -X POST http://localhost:3000/api/hooks/tool-use -H 'Content-Type: application/json' -d @-"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "cat | curl -s -X POST http://localhost:3000/api/hooks/tool-complete -H 'Content-Type: application/json' -d @-"
          }
        ]
      }
    ],
    "SubagentStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "cat | curl -s -X POST http://localhost:3000/api/hooks/agent-start -H 'Content-Type: application/json' -d @-"
          }
        ]
      }
    ],
    "SubagentStop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "cat | curl -s -X POST http://localhost:3000/api/hooks/agent-stop -H 'Content-Type: application/json' -d @-"
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "cat | curl -s -X POST http://localhost:3000/api/hooks/stop -H 'Content-Type: application/json' -d @-"
          }
        ]
      }
    ]
  }
}
```

You can also copy this config from the **Setup** button inside the web app.

### 3. Start the server

```bash
npm run dev
```

### 4. Open the browser

Go to [http://localhost:3000](http://localhost:3000)

All your active Claude Code sessions will appear as characters in the office within 10 seconds (discovered by the process scanner). If hooks are configured, you'll also see real-time tool usage, chat bubbles, and status changes.

### 5. Use Claude Code normally

Start, stop, or resume Claude Code sessions in any terminal. Characters walk in and out of the office automatically.

## Features

### Office Visualization
- **Pixel RPG office** with desks, meeting rooms, kitchen, bookshelves, plants
- **24 unique character sprites** with walk animations in 4 directions
- **Auto-discovery** of all active Claude Code sessions from running processes
- **Session names** resolved from `--resume` flags, `/rename` commands, or transcript slugs
- **Drag characters** to different chairs by clicking and dragging

### Real-Time Activity
- **Working animation** with flashing laptop when using tools
- **Idle indicator** (zzz emoji) when session is waiting for input
- **Chat bubbles** above characters during agent team meetings
- **Tool summary** on hover (e.g., "Reading lib/types.ts", "Running npm test")
- **Status dots** (green = working, gray = idle, blue = meeting)

### Agent Teams
- **3 meeting rooms** for concurrent agent teams
- **Characters walk to meeting rooms** when agents spawn
- **Chat bubbles** show what each agent is doing
- **Clean exit** — agents walk out when done, parent returns to desk
- **Anti-respawn** protection during shutdown handshake

### Session Management
- **Side panel** with Info and Settings tabs (click any character)
- **Session cycling** with arrows to browse all active sessions
- **Working directory** display and CLI command copy
- **Fire button** — kills session with packing-box-and-walk-out animation
- **Restart button** — kills session and shows resume command to paste in terminal
- **Resume Session modal** — browse and resume past sessions by project directory
- **Highlight ring** around selected character

### Task Board
- **View tasks** from `~/.claude/tasks/` organized by Pending / In Progress / Completed
- **Create tasks** with subject and description
- **Edit tasks** — change subject, description, or status
- **Assign tasks** — pick an existing session or spawn a new agent
- **Folder picker** for working directory selection
- **Refresh button** to reload task data

### Settings (per session)
- **Memory notes** — view and add project memory notes
- **MCP Server Store** — browse, install, and remove MCP servers with one click
- **Session info** — ID, working directory, parent session

### Header Bar
- **Connection status** indicator (green/red dot)
- **Sessions button** with active count badge
- **Resume Session** — browse past sessions with search
- **Tasks** — open the task board
- **Setup** — view/copy hook configuration

## Architecture

```
Claude Code Sessions
       |
       | (hooks: stdin -> curl -> HTTP POST)
       v
+---------------------+
|  Next.js API Routes  |  <-- /api/hooks/* endpoints
|  (Hook Receiver)     |
+---------------------+
|  Session Scanner     |  <-- ps aux every 10s
+---------------------+
|  Session Store       |  <-- In-memory state (globalThis for hot-reload persistence)
+---------------------+
|  Socket.io Server    |  <-- Push events to browser
+----------+----------+
           | WebSocket
           v
+---------------------+
|  Browser Client      |
|  +- Canvas Engine   |  <-- 16x17 sprites, BFS pathfinding, animations
|  +- Office Tilemap  |  <-- 38x26 tiles, programmatic rendering
|  +- React Overlays  |  <-- Side panel, task board, modals, hover cards
|  +- Socket.io Client|  <-- Receive real-time events
+---------------------+
```

## Desktop App (Electron)

Agent Matrix can run as a standalone desktop app with **interactive terminal sessions** — send prompts to Claude Code directly from the UI.

### Why Desktop?

The web app can monitor sessions but can't send prompts to them (browser can't access terminal processes). The Electron desktop app wraps the same UI but adds a PTY (pseudo-terminal) layer that lets you:

- **Send prompts** to any session from the Session Dialog's "Terminal" tab
- **Stream responses** back in real-time
- **Resume idle sessions** interactively — no terminal window needed
- **System tray** — runs in background, always monitoring
- Uses your existing **Claude Code authentication** and **settings** — no API key needed

### Run the Desktop App (Development)

```bash
# 1. Install dependencies (includes Electron + node-pty)
npm install

# 2. Start in dev mode
npm run electron:dev
```

This starts the Next.js server and opens the Electron window. The app is fully functional — office view, dashboard, prompting all work.

### Build for Distribution

```bash
# Build the Next.js app, then package with electron-builder
npm run electron:build
```

This produces platform-specific installers:
- **macOS**: `.dmg` in `dist/`
- **Windows**: `.exe` installer in `dist/`
- **Linux**: `.AppImage` and `.deb` in `dist/`

### How Prompting Works

1. Click a session (office or dashboard view) → Session Dialog opens
2. Go to the **Terminal** tab
3. Type a prompt and press Enter
4. Agent Matrix spawns a PTY running `claude --resume <session> --dangerously-skip-permissions`
5. Your prompt is sent to Claude's stdin, responses stream back in real-time
6. The PTY persists — you can send multiple prompts in the same session

**Note:** Prompting only works for sessions you resume from the UI. Sessions running in an external terminal are read-only (visible but not interactive).

### Desktop App Architecture

```
Electron Main Process
├── Next.js server (same as web mode)
├── Session scanner (process discovery)
├── Socket.io server (real-time events)
├── PTY Manager (terminal sessions)
│   ├── Spawns claude --resume <name>
│   ├── stdin.write(prompt) ← from browser
│   └── stdout → Socket.io → browser
└── System tray (background mode)
```

## Development (Web Only)

```bash
npm run dev      # Start dev server (tsx server.ts)
npm run build    # Production build
npm start        # Start production server
```

The web app uses a custom `server.ts` that wraps Next.js with Socket.io. Hot reload works for both the Next.js frontend and the API routes. The web app has all features except interactive prompting (which requires the Electron desktop app).

## Project Structure

```
AgentMatrix/
+-- server.ts                    # Custom HTTP server (Next.js + Socket.io)
+-- electron/                    # Electron desktop app (optional)
|   +-- main.ts                  # Electron main process + server startup
|   +-- preload.ts               # Context bridge for renderer
|   +-- promptBridge.ts          # Socket.io <-> PTY bridge
|   +-- pty/
|       +-- PtyManager.ts        # Spawn/manage Claude terminal sessions
|       +-- OutputParser.ts      # ANSI stripping, prompt-ready detection
|       +-- index.ts
+-- app/
|   +-- page.tsx                 # Main page (office + dashboard views)
|   +-- layout.tsx               # Root layout
|   +-- globals.css              # Dark theme styles
|   +-- api/
|   |   +-- hooks/               # 7 hook receiver endpoints
|   |   +-- tasks/               # Task CRUD APIs
|   |   +-- sessions/            # Session management APIs
|   |   +-- dirs/                # Directory browser API
|   +-- components/
|       +-- OfficeCanvas.tsx     # Dual-canvas game renderer
|       +-- DashboardView.tsx    # Card grid session dashboard
|       +-- SessionDialog.tsx    # Session detail modal (Info/Settings/Terminal)
|       +-- PromptPanel.tsx      # Interactive prompt UI for Terminal tab
|       +-- FloatingSprite.tsx   # Animated sprite beside dialog
|       +-- TaskBoard.tsx        # Task management board
|       +-- HeaderBar.tsx        # Top nav with Office/Dashboard toggle
|       +-- HoverCard.tsx        # Character hover tooltip
|       +-- SetupModal.tsx       # Hook configuration modal
|       +-- ResumeModal.tsx      # Resume past sessions
|       +-- SocketProvider.tsx   # Socket.io React context
+-- lib/
|   +-- types.ts                 # TypeScript interfaces
|   +-- constants.ts             # Grid, colors, positions, tile map
|   +-- engine/                  # Canvas rendering engine
|   |   +-- GameEngine.ts        # Main render loop
|   |   +-- Character.ts         # Sprite animation, movement, effects
|   |   +-- CharacterManager.ts  # Spawn, despawn, meeting rooms
|   |   +-- TileMap.ts           # Office floor rendering
|   |   +-- SpriteSheet.ts       # Sprite frame extraction
|   |   +-- Pathfinder.ts        # BFS grid pathfinding
|   |   +-- ConnectionLine.ts    # Glowing lines between characters
|   +-- state/
|   |   +-- sessionStore.ts      # In-memory session state
|   |   +-- sessionScanner.ts    # Process discovery + name resolution
|   |   +-- sessionName.ts       # Name resolution from transcripts
|   |   +-- nameCache.ts         # Persistent name cache across restarts
|   |   +-- socketEmitter.ts     # Server-side socket emit helper
|   +-- hooks/
|       +-- useSocket.ts         # Client socket event hook
|       +-- usePrompt.ts         # Prompt send/receive hook (Electron)
+-- public/
|   +-- sprites/characters.png   # 24-character sprite sheet (CC0 license)
+-- electron-builder.yml         # Desktop app packaging config
```

## Requirements

- Node.js 18+
- Claude Code CLI with hooks support
- macOS or Linux (process scanner uses `ps aux`)

### Platform Support

| Platform | Status | Notes |
|----------|--------|-------|
| macOS | Full support | Primary development platform |
| Linux / Devbox | Full support | Recommended for remote setups |
| WSL | Full support | Best option for Windows users |
| Windows native | Partial | Hooks work, but process scanner needs `ps aux` — use WSL instead |

### Recommended: Run on a Devbox

For the best experience, especially in team settings, run Agent Matrix on a devbox or remote machine where all your Claude Code sessions run. This way the process scanner can discover all sessions in one place, and you can access the dashboard from any browser.

## Credits

- Character sprites: [Evert/mdkieran on OpenGameArt](https://opengameart.org/content/tiny-characters-set) (CC0)
- Built with Next.js, React, Socket.io, HTML Canvas
