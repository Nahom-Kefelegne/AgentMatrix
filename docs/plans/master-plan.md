# Claude Office Visualizer - Implementation Plan

## Context

Build a lightweight web app that visualizes active Claude Code sessions and agents as pixelated characters in a top-down pixel RPG-style office. Characters move around, show working/idle status, and display summaries of what they're working on. Agent team interactions are visualized as meetings and communication lines. The goal is a fun, visual way to see all your Claude Code activity at a glance.

**Timeline**: 2 days
**Repo**: New standalone repo (user will clone)

---

## Decisions Summary

| Decision | Choice |
|----------|--------|
| Data source | Live hooks + historical session parsing |
| Rendering | HTML Canvas + 16x16 pixel sprites |
| Stack | Next.js + Canvas + socket.io |
| Characters | Generic base sprite with color tints + name labels |
| Layout | Single open floor (desks, meeting area, reception) |
| Session mapping | Auto-assign by name + basic Claude skill for setup + web app rename |
| Info display | Small info card on hover + side panel on click |
| Meetings | Hybrid: team creation = walk to room, messages = connection lines |
| Sprites | Free 16x16 RPG sprite sheet from itch.io |
| Users | Single user |

---

## Architecture

```
Claude Code Sessions (hooks)
       │
       ▼ HTTP POST
┌─────────────────────┐
│  Next.js API Routes  │  ← /api/hooks/* endpoints
│  (Hook Receiver)     │
├─────────────────────┤
│  Session State Store │  ← In-memory state + historical parse
│  (server-side)       │
├─────────────────────┤
│  Socket.io Server    │  ← Push events to browser
└────────┬────────────┘
         │ WebSocket
         ▼
┌─────────────────────┐
│  Browser Client      │
│  ├─ Canvas Engine    │  ← 16x16 sprite rendering, movement, animation
│  ├─ Office Tilemap   │  ← Floor, desks, meeting area, reception
│  ├─ Character Manager│  ← Spawn, move, animate characters
│  ├─ Info Card/Panel  │  ← Hover card + click side panel (React)
│  └─ Socket.io Client │  ← Receive real-time events
└─────────────────────┘
```

---

## Day 1: Foundation

### Step 1: Project Scaffolding
- `npx create-next-app@latest claude-office --typescript --app`
- Install deps: `socket.io`, `socket.io-client`
- Set up project structure:
  ```
  /app
    /api/hooks/         ← API routes for each hook event
    /page.tsx           ← Main page with Canvas
  /lib
    /engine/            ← Canvas rendering engine
      canvas.ts         ← Main render loop
      sprites.ts        ← Sprite loading + drawing
      tilemap.ts        ← Office floor/furniture tiles
      characters.ts     ← Character state, movement, animation
    /state/
      sessionStore.ts   ← In-memory session/agent state
      eventBus.ts       ← Internal event emitter
    /hooks/
      socketProvider.tsx ← Socket.io React context
    /types/
      index.ts          ← TypeScript types for sessions, agents, events
  /public
    /sprites/           ← 16x16 sprite sheet PNGs
    /tiles/             ← Office tilemap assets
  /server/
    socketServer.ts     ← Socket.io server setup (custom server or API route)
  ```

### Step 2: Hook Receiver (API Routes)
- Create API routes for each hook event:
  - `POST /api/hooks/session-start` — New session → spawn character
  - `POST /api/hooks/session-end` — Session ends → character exits
  - `POST /api/hooks/tool-use` — PreToolUse → character starts working animation
  - `POST /api/hooks/tool-complete` — PostToolUse → log action, update info card
  - `POST /api/hooks/agent-start` — SubagentStart → spawn agent character, walk to meeting if team
  - `POST /api/hooks/agent-stop` — SubagentStop → agent character exits
  - `POST /api/hooks/stop` — Claude stops responding → character goes idle
- Each route:
  1. Parses hook JSON payload
  2. Updates in-memory session store
  3. Emits event via socket.io to browser

### Step 3: Session State Store
- In-memory store tracking:
  ```typescript
  interface Session {
    id: string;
    name: string;           // session name/rename
    role: string;           // auto-assigned or from skill
    color: string;          // tint color for sprite
    status: 'working' | 'idle' | 'meeting';
    deskPosition: { x: number; y: number };
    currentTool?: string;
    recentActions: Action[]; // last 5 actions
    agents: Agent[];         // spawned subagents
    teamId?: string;
  }
  ```
- Historical parsing: On server start, scan `~/.claude/projects/` for recent session data to pre-populate

### Step 4: Canvas Engine — Office Tilemap
- Design a single open floor tilemap (roughly 320x240 pixels = 20x15 tiles at 16px):
  - **Top-left**: Reception desk area
  - **Center**: 6-8 work desks in rows
  - **Bottom-right**: Meeting room/table area
  - **Entrance**: Bottom or left side
- Draw tiles programmatically or use a simple tile sheet
- Render at 2x-3x scale for visibility (640x480 or 960x720 on screen)

### Step 5: Canvas Engine — Character Rendering
- Load 16x16 sprite sheet (idle, walk-down, walk-up, walk-left, walk-right frames)
- Color tinting via Canvas `globalCompositeOperation` or pre-tinted variants
- Render name labels below characters (small pixel font or Canvas fillText)
- Basic animation loop: idle bobbing when stationary, walk cycle when moving

---

## Day 2: Interactions + Polish

### Step 6: Character Movement & Pathfinding
- Simple grid-based movement (A* not needed — direct path with basic obstacle avoidance)
- Movement triggers:
  - Session start → character walks in from entrance to assigned desk
  - Team created → team members walk from desks to meeting table
  - Team message → connection line drawn between characters at desks
  - Session end → character walks to entrance and disappears
  - Agent spawn → new character appears near parent, walks to desk or meeting

### Step 7: Info Card (Hover) + Side Panel (Click)
- **Hover**: Small floating card rendered in React overlay on top of Canvas
  - Session name, status badge, current tool, last 3 actions
- **Click**: Side panel slides in from right
  - Full activity log (scrollable)
  - Task list if available
  - Agent team members list
  - Rename option (text input to rename session in the store)

### Step 8: Meeting Room Interactions
- When `SubagentStart` with team context fires:
  - Parent + spawned agents walk to meeting area
  - Small speech bubbles appear briefly (tool name or message summary)
- When team messages (SendMessage) fire:
  - If agents at desks → draw glowing connection line between them
  - Line fades after 2-3 seconds
- When `SubagentStop` fires:
  - Agent character walks back to desk, then exits

### Step 9: Socket.io Integration
- Custom Next.js server (`server.ts`) to attach socket.io
- Events emitted to client:
  ```
  session:start    → { session }
  session:end      → { sessionId }
  session:update   → { sessionId, changes }
  agent:start      → { sessionId, agent }
  agent:stop       → { sessionId, agentId }
  tool:start       → { sessionId, toolName, toolInput }
  tool:complete    → { sessionId, toolName }
  meeting:start    → { teamId, participants }
  meeting:message  → { teamId, from, summary }
  ```

### Step 10: Claude Skill for Setup
- Basic skill (`.claude/skills/office-setup.md`) that:
  1. Reads current session context (what the user is working on)
  2. Suggests a session name and role
  3. Configures hooks in user's settings if not already present
  4. Renames the session via `/rename`
- Keep it simple — just a prompt-based skill with a few tool calls

### Step 11: Hook Configuration Generator
- A setup script or first-run page that generates the hooks JSON config
- User copies it into `~/.claude/settings.json` (or the skill does it)
- Template:
  ```json
  {
    "hooks": {
      "SessionStart": [{ "matcher": "", "hooks": [{ "type": "http", "url": "http://localhost:3000/api/hooks/session-start", "timeout": 5 }] }],
      "PreToolUse": [{ "matcher": ".*", "hooks": [{ "type": "http", "url": "http://localhost:3000/api/hooks/tool-use", "timeout": 5 }] }],
      "PostToolUse": [{ "matcher": ".*", "hooks": [{ "type": "http", "url": "http://localhost:3000/api/hooks/tool-complete", "timeout": 5 }] }],
      "SubagentStart": [{ "matcher": ".*", "hooks": [{ "type": "http", "url": "http://localhost:3000/api/hooks/agent-start", "timeout": 5 }] }],
      "SubagentStop": [{ "matcher": ".*", "hooks": [{ "type": "http", "url": "http://localhost:3000/api/hooks/agent-stop", "timeout": 5 }] }],
      "Stop": [{ "hooks": [{ "type": "http", "url": "http://localhost:3000/api/hooks/stop", "timeout": 5 }] }],
      "SessionEnd": [{ "matcher": ".*", "hooks": [{ "type": "http", "url": "http://localhost:3000/api/hooks/session-end", "timeout": 5 }] }]
    },
    "allowedHttpHookUrls": ["http://localhost:3000/*"]
  }
  ```

---

## Verification

1. **Hooks working**: Start the web app → start a Claude Code session → verify character appears in the office
2. **Tool use visualization**: Run a command in Claude → character shows working animation, info card updates
3. **Agent teams**: Spawn an agent team → verify characters walk to meeting room, connection lines appear
4. **Session end**: Exit a Claude session → character walks out and disappears
5. **Hover/click**: Hover a character → info card shows. Click → side panel with activity log
6. **Rename**: Rename a session via the web app → label updates on character
7. **Historical**: Restart the web app → verify previously active sessions are loaded from history

---

## Out of Scope (Post-MVP)
- Multi-user / shared office
- Persistent storage (database)
- 32x32 or higher-res sprites
- Multi-room floor plan
- Sound effects
- Unique sprites per role (all generic + tint for now)
- Advanced pathfinding (A*)
- Mobile responsive layout
