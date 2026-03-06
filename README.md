# AgentMatrix

A pixel RPG-style office that visualizes your active Claude Code sessions in real time. Each session appears as a character that walks to a desk, shows working/idle animations, and displays what tools are being used. Agent teams gather at a meeting table with connection lines between them.

## Quick Start

### 1. Install dependencies

```bash
git clone https://github.com/Nahom-Kefelegne/AgentMatrix.git
cd AgentMatrix
npm install
```

### 2. Configure Claude Code hooks

Add the following to your `~/.claude/settings.json` (merge with existing settings):

```json
{
  "hooks": {
    "SessionStart": [
      {
        "type": "command",
        "command": "curl -s -X POST http://localhost:3000/api/hooks/session-start -H 'Content-Type: application/json' -d \"$CLAUDE_EVENT_DATA\""
      }
    ],
    "SessionEnd": [
      {
        "type": "command",
        "command": "curl -s -X POST http://localhost:3000/api/hooks/session-end -H 'Content-Type: application/json' -d \"$CLAUDE_EVENT_DATA\""
      }
    ],
    "PreToolUse": [
      {
        "matcher": ".*",
        "type": "command",
        "command": "curl -s -X POST http://localhost:3000/api/hooks/tool-use -H 'Content-Type: application/json' -d \"$CLAUDE_EVENT_DATA\""
      }
    ],
    "PostToolUse": [
      {
        "matcher": ".*",
        "type": "command",
        "command": "curl -s -X POST http://localhost:3000/api/hooks/tool-complete -H 'Content-Type: application/json' -d \"$CLAUDE_EVENT_DATA\""
      }
    ],
    "SubagentStart": [
      {
        "matcher": ".*",
        "type": "command",
        "command": "curl -s -X POST http://localhost:3000/api/hooks/agent-start -H 'Content-Type: application/json' -d \"$CLAUDE_EVENT_DATA\""
      }
    ],
    "SubagentStop": [
      {
        "matcher": ".*",
        "type": "command",
        "command": "curl -s -X POST http://localhost:3000/api/hooks/agent-stop -H 'Content-Type: application/json' -d \"$CLAUDE_EVENT_DATA\""
      }
    ],
    "Stop": [
      {
        "type": "command",
        "command": "curl -s -X POST http://localhost:3000/api/hooks/stop -H 'Content-Type: application/json' -d \"$CLAUDE_EVENT_DATA\""
      }
    ]
  }
}
```

You can also copy this from the Setup modal inside the app (click the gear icon in the header).

### 3. Start the visualizer

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 4. Use Claude Code normally

Start any Claude Code session in your terminal. A character will appear in the office, walk to an available desk, and start showing activity as you work.

## What you'll see

- **Sessions as characters** -- Each Claude Code session gets a colored character with a name label
- **Walk-in animation** -- Characters enter from the door and walk to their assigned desk
- **Working status** -- Green dot when using tools, gray when idle, blue during meetings
- **Hover card** -- Mouse over a character to see their name, status, current tool, and recent actions
- **Side panel** -- Click a character for full details including activity log and team members
- **Agent teams** -- When you spawn agent teams, characters gather at the meeting table with connection lines between them
- **Walk-out animation** -- When a session ends, the character walks back to the door and disappears

## Architecture

```
Claude Code (hooks) --HTTP POST--> Next.js API Routes
                                        |
                                  Session Store (in-memory)
                                        |
                                  Socket.io --> Browser
                                        |
                                  Canvas Engine (16x16 pixel art)
```

- **Next.js App Router** -- API routes receive hook events, serve the frontend
- **Socket.io** -- Real-time push from server to browser
- **Canvas** -- 480x320 native (30x20 tiles at 16px), rendered at 3x scale (1440x960)
- **Custom server** (`server.ts`) -- Wraps Next.js with socket.io support

## Development

```bash
npm run dev      # Start dev server with hot reload
npm run build    # Production build
npm start        # Start production server
```

The office currently renders with programmatic colored tiles. Sprite sheet integration (from itch.io assets) is planned for a future update.

## Requirements

- Node.js 18+
- Claude Code CLI with hooks support
