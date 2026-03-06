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

## Development

```bash
npm run dev      # Start dev server (tsx server.ts)
npm run build    # Production build
npm start        # Start production server
```

The app uses a custom `server.ts` that wraps Next.js with Socket.io. Hot reload works for both the Next.js frontend and the API routes.

## Project Structure

```
AgentMatrix/
+-- server.ts                    # Custom HTTP server (Next.js + Socket.io)
+-- app/
|   +-- page.tsx                 # Main page
|   +-- layout.tsx               # Root layout
|   +-- globals.css              # Dark theme styles
|   +-- api/
|   |   +-- hooks/               # 7 hook receiver endpoints
|   |   +-- tasks/               # Task CRUD APIs
|   |   +-- sessions/            # Session management APIs
|   |   +-- dirs/                # Directory browser API
|   +-- components/
|       +-- OfficeCanvas.tsx     # Dual-canvas game renderer
|       +-- SidePanel.tsx        # Session info/settings panel
|       +-- TaskBoard.tsx        # Task management board
|       +-- HeaderBar.tsx        # Top navigation bar
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
|   |   +-- socketEmitter.ts     # Server-side socket emit helper
|   +-- hooks/
|       +-- useSocket.ts         # Client socket event hook
+-- public/
    +-- sprites/characters.png   # 24-character sprite sheet (CC0 license)
```

## Requirements

- Node.js 18+
- Claude Code CLI with hooks support
- macOS (process scanner uses `ps aux` with macOS conventions)

## Credits

- Character sprites: [Evert/mdkieran on OpenGameArt](https://opengameart.org/content/tiny-characters-set) (CC0)
- Built with Next.js, React, Socket.io, HTML Canvas
