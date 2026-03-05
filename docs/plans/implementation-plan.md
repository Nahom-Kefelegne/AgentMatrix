# Claude Office Visualizer — Implementation Plan

## Context

Build a web app that visualizes active Claude Code sessions as pixelated characters in a top-down pixel RPG-style office. Characters walk around, show working/idle status, and display summaries of what they're working on. Agent teams are visualized as meetings. This is a fun, visual dashboard for all Claude Code activity.

**Repo**: `AgentMatrix`
**App**: `claude-office/` (Next.js, already scaffolded)
**Master plan**: `docs/plans/master-plan.md`

---

## Design Decisions (from user interview)

| Decision | Choice |
|----------|--------|
| Page layout | Full-screen canvas, minimal header |
| Side panel | Overlay with transparent backdrop, slides from right, click-outside dismisses |
| Hover card | Detailed: name, status, current tool, last 2-3 actions |
| Setup | Modal on main page (gear icon), hook config JSON + copy + status |
| Scaling | Fixed map (1440x960), centered in viewport |
| Map size | 30x20 tiles (480x320 base, 3x scale) |
| Desks | 8 fixed, auto-assign, overflow to waiting area |
| Tilemap art | Free itch.io 16x16 RPG tileset (with programmatic fallback) |
| Characters | Pixel art 16x16 sprite sheet, color tint, walk animations |
| Meetings | Simple gathering at meeting table + connection lines |

---

## Project Structure

```
claude-office/
├── server.ts                          # Custom HTTP server (socket.io + Next.js)
├── app/
│   ├── layout.tsx                     # (MODIFY) Dark bg, metadata
│   ├── page.tsx                       # (REPLACE) Full-screen office page
│   ├── globals.css                    # (REPLACE) Dark theme, full-screen styles
│   ├── api/hooks/
│   │   ├── session-start/route.ts
│   │   ├── session-end/route.ts
│   │   ├── tool-use/route.ts
│   │   ├── tool-complete/route.ts
│   │   ├── agent-start/route.ts
│   │   ├── agent-stop/route.ts
│   │   └── stop/route.ts
│   └── components/
│       ├── OfficeCanvas.tsx           # Canvas + render loop bootstrap
│       ├── HeaderBar.tsx              # Top bar: title, Setup gear, Help
│       ├── HoverCard.tsx              # Floating info card on hover
│       ├── SidePanel.tsx              # Right-slide overlay on click
│       ├── SetupModal.tsx             # Hook config modal
│       └── SocketProvider.tsx         # Socket.io React context
├── lib/
│   ├── types.ts                       # All TypeScript interfaces
│   ├── constants.ts                   # Grid dims, scale, tile enum, positions, colors
│   ├── engine/
│   │   ├── GameEngine.ts             # Main loop: update + render
│   │   ├── SpriteSheet.ts            # Load sprite sheet, extract frames
│   │   ├── TileMap.ts                # 30x20 grid, render tiles
│   │   ├── Character.ts              # Position, movement, animation, tint
│   │   ├── CharacterManager.ts       # Spawn/remove/update/hit-test characters
│   │   ├── Pathfinder.ts             # BFS grid pathfinding
│   │   └── ConnectionLine.ts         # Glowing lines between characters
│   ├── state/
│   │   ├── sessionStore.ts           # In-memory Map<string, Session>
│   │   └── socketEmitter.ts          # Server-side socket emit helper
│   └── hooks/
│       └── useSocket.ts              # Client: subscribe to events, return state
├── public/
│   ├── sprites/characters.png         # 16x16 RPG character sprite sheet
│   └── tiles/office-tileset.png       # 16x16 office tileset
└── next.config.ts
```

---

## Office Tilemap (30x20)

```
Col: 0         1         2
     012345678901234567890123456789
   ┌──────────────────────────────┐
 0 │######_####_####_####_########│  North wall with windows
 1 │#P...........................P#│  Border floor
 2 │#..B..D.D....D.D....D.D..B..#│  Row 1 desks (6 positions)
 3 │#..B..C.C....C.C....C.C..B..#│  Row 1 chairs
 4 │#............................#│  Aisle
 5 │#.....D.D....D.D............#│  Row 2 desks (4 positions)
 6 │#.....C.C....C.C......K.K...#│  Row 2 chairs + kitchen
 7 │#.................K..K.K.K...#│  Kitchen area
 8 │#............................#│  Aisle
 9 │#............................#│  Open space
10 │#...~~~~~~~~~~~~~~~..........#│  Meeting carpet start
11 │#...~.............~..oooo....#│  Meeting + overflow area
12 │#...~..m.m.m.m.m..~..oooo...#│  Meeting chairs top
13 │#...~..M.M.M.M.M..~..W......#│  Meeting table
14 │#...~..M.M.M.M.M..~..W......#│  Meeting table
15 │#...~..m.m.m.m.m..~.........#│  Meeting chairs bottom
16 │#...~.............~..........#│  Meeting rug
17 │#...~~~~~~~~~~~~~~~..........#│  Meeting carpet end
18 │#.........R.R................#│  Reception near entrance
19 │####EE####EE####_####_#######│  South wall + entrance doors
   └──────────────────────────────┘
```

**8 desk positions** (chair tiles where characters sit):
| Desk | Tile (x,y) |
|------|-----------|
| 1 | (6, 3) |
| 2 | (8, 3) |
| 3 | (13, 3) |
| 4 | (15, 3) |
| 5 | (20, 3) |
| 6 | (22, 3) |
| 7 | (6, 6) |
| 8 | (8, 6) |

**Entrance**: (10, 19)
**Meeting positions**: top row (8,12)-(16,12), bottom row (8,15)-(16,15)
**Overflow/waiting**: (21-24, 11-12)

---

## Key Types (`lib/types.ts`)

```typescript
export interface SessionData {
  id: string;
  name: string;
  color: string;
  status: 'idle' | 'working' | 'meeting';
  deskIndex: number;
  deskPosition: { x: number; y: number };
  spawnPosition: { x: number; y: number };
  currentTool?: string;
  recentActions: Action[];
  agents: AgentData[];
  teamId?: string;
  cwd?: string;
  createdAt: number;
}

export interface AgentData {
  id: string; name: string; parentSessionId: string;
  teamName?: string; color: string;
  status: 'idle' | 'working' | 'meeting';
  position: { x: number; y: number };
  currentTool?: string; createdAt: number;
}

export interface Action { toolName: string; summary: string; timestamp: number; }

export interface CharacterData {
  id: string; name: string; color: string;
  status: 'idle' | 'working' | 'meeting';
  currentTool?: string; recentActions: Action[];
  teamId?: string; isAgent: boolean; parentName?: string;
}
```

---

## Canvas Engine Architecture

```
GameEngine (requestAnimationFrame loop)
  ├── TileMap        — renders 30x20 office background
  ├── CharacterManager — manages Character instances
  │   └── Character[] — sprite, position, path, animation, tint
  ├── ConnectionLine[] — temporary glowing lines
  └── Mouse handling   — hit-test → callbacks to React
```

**Render order**: Tilemap → Shadows → Characters (Y-sorted) → Connection lines → Labels → Status dots

**Character movement**: BFS pathfinding on walkable tiles, 48px/sec (3 tiles/sec), 4-frame walk cycle at 0.15s/frame

**Color tinting**: Draw sprite to offscreen canvas, apply `source-atop` composite with color at 40% alpha

---

## Socket.io Setup

Custom `server.ts` — HTTP server wrapping Next.js + socket.io (`/api/socketio` path). Socket.io instance stored on `globalThis.__socketIO` so API routes can emit.

**Events**: `state:snapshot`, `session:start`, `session:end`, `session:update`, `tool:start`, `tool:complete`, `agent:start`, `agent:stop`, `meeting:start`, `meeting:message`

**Client**: `useSocket()` hook connects, listens to all events, maintains `Map<string, SessionData>` state, bridges to GameEngine methods.

---

## Hook API Routes

Each route: parse JSON → update sessionStore → emit via socket.io → return `{ ok: true }`

| Route | Event | Action |
|-------|-------|--------|
| `session-start` | SessionStart | Create session, assign desk & color, spawn character |
| `session-end` | SessionEnd | Remove session, free desk, despawn character |
| `tool-use` | PreToolUse | Set status='working', set currentTool |
| `tool-complete` | PostToolUse | Push to recentActions, clear currentTool |
| `agent-start` | SubagentStart | Create agent, link to parent, assign position |
| `agent-stop` | SubagentStop | Remove agent from parent |
| `stop` | Stop | Set status='idle', clear currentTool |

---

## Assets

**Tileset**: LimeZu - Modern Interiors (free) — https://limezu.itch.io/moderninteriors
**Characters**: route1rodent - 16x16 RPG Character Sprite Sheet — https://route1rodent.itch.io/16x16-rpg-character-sprite-sheet
**Fallback**: Programmatic colored rectangles for tiles, colored circles for characters

---

## Build Order (5 phases, strictly sequential)

### Phase 1: Skeleton
Static office rendering on canvas — no networking.
- `lib/types.ts`, `lib/constants.ts`
- `lib/engine/TileMap.ts` (colored rectangles fallback)
- `lib/engine/GameEngine.ts` (minimal loop)
- `app/globals.css`, `app/components/OfficeCanvas.tsx`, `app/page.tsx`, `app/layout.tsx`
- **Verify**: `npm run dev` → 1440x960 pixel office grid centered on screen

### Phase 2: Characters
Spawn characters, walk to desks with animation.
- `lib/engine/SpriteSheet.ts`, `lib/engine/Character.ts`, `lib/engine/Pathfinder.ts`, `lib/engine/CharacterManager.ts`
- Download sprite assets to `/public/sprites/`
- Integrate into GameEngine, test with mock spawns
- **Verify**: 3 characters walk from entrance to desks, show idle animation with tints and labels

### Phase 3: Networking
Socket.io server, API routes, real-time browser updates.
- `server.ts`, `lib/state/sessionStore.ts`, `lib/state/socketEmitter.ts`
- All 7 API routes in `app/api/hooks/`
- `app/components/SocketProvider.tsx`, `lib/hooks/useSocket.ts`
- Update `package.json` scripts, add `tsx` dependency
- Wire socket events to GameEngine in OfficeCanvas
- **Verify**: `curl -X POST localhost:3000/api/hooks/session-start` → character spawns in browser

### Phase 4: UI Overlays
Hover card, side panel, setup modal, header bar.
- `app/components/HeaderBar.tsx`, `HoverCard.tsx`, `SidePanel.tsx`, `SetupModal.tsx`
- Wire mouse events from OfficeCanvas to React overlays
- **Verify**: Hover → info card, Click → side panel, Gear → setup modal with config JSON

### Phase 5: Meetings & Polish
Team visualization, connection lines, real tileset integration.
- `lib/engine/ConnectionLine.ts`
- Meeting logic in CharacterManager (walk to meeting area, return to desks)
- Download and integrate itch.io tileset to replace colored rectangles
- Status animations (working bob, idle still)
- Edge case handling
- **Verify**: Configure hooks in Claude Code, run a real session, see full lifecycle

---

## Verification (end-to-end)

1. Start the app with `npm run dev` (uses custom `server.ts`)
2. Open browser to `http://localhost:3000` — see empty office
3. Start a Claude Code session with hooks configured → character walks in from entrance to desk
4. Use tools in Claude → character shows working animation, hover card updates
5. Spawn an agent team → agents gather at meeting table, connection lines appear
6. End session → character walks out and disappears
7. Click Setup gear → see hook config JSON, copy to clipboard
