# Agent Matrix — Architecture Design Documents

## Overview

Agent Matrix is a desktop application that turns CLI coding agents (GitHub Copilot CLI and Claude Code) into a visual, manageable multi-session powerhouse. It wraps CLI sessions in an Electron app with real-time monitoring, pixel RPG visualization, integrated terminals, task management, and inter-session context transfer.

**No API keys needed** — every agent is a real CLI session with full terminal, file system, and git access.

**Repo:** https://github.com/Nahom-Kefelegne/AgentMatrix

---

## System Architecture

```mermaid
graph TB
    subgraph "Electron Process"
        Main["electron/main.ts<br/>Window, Tray, Lifecycle"]
        PTY["PtyManager<br/>node-pty sessions"]
        CQ["captureQuery<br/>Copilot ACP / Claude file capture"]
        TB["TerminalBridge<br/>Socket ↔ PTY"]
        Orch["OrchestratorService<br/>Hidden Copilot session"]
        Summary["SummaryService<br/>AI work summaries"]
        Handoff["HandoffService<br/>Context transfer"]
    end

    subgraph "Next.js Server (server.ts)"
        HTTP["HTTP Server<br/>port 3000"]
        SIO["Socket.io Server<br/>Real-time events"]
        API["API Routes<br/>/api/*"]
        State["State Layer<br/>globalThis stores"]
    end

    subgraph "Browser (React)"
        UI["React Components<br/>Dashboard / Office / Editor"]
        XTerm["xterm.js<br/>Terminal panels"]
        Canvas["Canvas Engine<br/>Pixel RPG office"]
    end

    subgraph "External"
        CLI["CLI agents<br/>Copilot / Claude hooks → HTTP POST"]
        ADO["Azure DevOps<br/>az CLI proxy"]
    end

    Main -->|starts| HTTP
    Main -->|manages| PTY
    PTY -->|stdin/stdout| CLI
    TB -->|bridges| PTY
    TB <-->|events| SIO
    CQ -->|ACP or stdin/file fallback| PTY
    Orch -->|uses| CQ
    Summary -->|uses| CQ
    Handoff -->|uses| CQ

    CLI -->|hooks POST| API
    API -->|updates| State
    State -->|emits| SIO
    SIO <-->|real-time| UI
    SIO <-->|terminal I/O| XTerm

    API -->|az CLI| ADO

    HTTP -->|serves| UI
```

## Data Flow

```mermaid
flowchart LR
    subgraph "CLI Session"
        CLI["Copilot or Claude CLI"]
        Hook["Hook fires<br/>(tool use, session start, etc.)"]
    end

    subgraph "Agent Matrix Backend"
        Route["API Route<br/>/api/hooks/*"]
        Store["Session Store<br/>(globalThis)"]
        Socket["Socket.io<br/>emit()"]
    end

    subgraph "Browser"
        Handler["useSocket hook"]
        State["React State<br/>(sessions Map)"]
        View["UI Render<br/>(Dashboard / Office / Canvas)"]
    end

    CLI --> Hook
    Hook -->|"HTTP POST + JSON"| Route
    Route -->|"update session"| Store
    Store -->|"socket.emit(event)"| Socket
    Socket -->|"real-time"| Handler
    Handler -->|"setState"| State
    State -->|"re-render"| View
```

## Design Documents

| Document | Scope | Key Topics |
|----------|-------|------------|
| [Control Center](dashboard-v2.md) | Console-first dashboard and Context Canvas | Native command rail, unified session list, embedded CLI, fullscreen, Monaco code/diff preview, navigation tools, focus and security contracts |
| [Context Canvas Markdown](context-canvas-markdown.md) | Rendered session design documents | Sanitized GFM rendering, Preview/Source, automatic docs/design previews, file-change event and link security contracts |
| [Frontend/UI](frontend-ui.md) | React components, views, modals | Component hierarchy, 3 view modes (Dashboard/Office/Editor), session dialog, terminal panels, canvas engine, real-time socket handling, splash screen |
| [Backend/Server](backend-server.md) | Server, APIs, Socket.io, hooks | Server startup, 30+ API endpoints, 22 socket events, CLI hook system, session lifecycle, ADO integration, state stores |
| [Electron/PTY](electron-pty.md) | Electron main process, terminals | Window/tray lifecycle, PTY spawning, prompt injection system, terminal bridge, auto-resume, session naming, production build |
| [Services/State](services-state.md) | Services layer, state management | Orchestrator service, summary generation, context handoff, task system, globalThis persistence, type definitions, cache files |

---

## Key Architectural Decisions

### 1. Real CLI Sessions (Not API Calls)
Every agent is a real `copilot` or `claude` CLI process spawned via `node-pty`. This gives each session full terminal access, file system, git, and native CLI features (tools, hooks, subagents). The tradeoff is complexity in PTY management, but the capability is unmatched.

### 2. Hooks as the Event System
Claude Code and GitHub Copilot CLI hooks fire HTTP POST requests to the app's API routes. This is the primary way the app knows what's happening in each session.

### 3. Out-of-Band Capture for Structured Output
The app's killer feature. To get structured data from a session:
1. Use Copilot ACP for Copilot sessions when available
2. Fall back to writing a prompt to PTY stdin telling Claude to write output to a temp file
3. Read, parse, and clean up

This powers: work summaries, task assignment, context handoff, and deep search. It's simple, reliable, and avoids parsing the TUI.

### 4. globalThis for State Persistence
All session state lives on `globalThis` to survive Next.js hot reloads in dev mode. This is unconventional but necessary — Next.js re-imports modules on every change, which would wipe in-memory state. File-backed caches under `~/.agentmatrix/` provide persistence across app restarts.

### 5. Socket.io as the Real-Time Layer
Every state change flows through Socket.io. The backend emits events, the frontend subscribes. No polling, no REST-based refresh. This gives the UI instant updates when a CLI uses a tool, an agent spawns, or a session ends.

### 6. Dual Canvas for Office View
The pixel RPG office uses two overlapping canvases:
- **Bottom canvas**: Pixel art (tiles, characters, furniture) via ImageData manipulation
- **Top canvas**: Text overlay (names, chat bubbles) via Canvas 2D API

This separation allows crisp text rendering on top of pixel-perfect sprite art.

---

## Runtime File Map

### Source Code
```
AgentMatrix/
├── app/
│   ├── page.tsx                    # Main page, view mode state
│   ├── layout.tsx                  # Root layout (Inter font, metadata)
│   ├── components/                 # All React components (28+)
│   │   ├── editor/                 # VS Code-like editor (disabled)
│   │   └── ...
│   └── api/                        # Next.js API routes (30+ endpoints)
│       ├── hooks/                  # CLI hook receivers
│       ├── sessions/               # Session management
│       ├── editor/                 # File & git operations
│       ├── ado/                    # Azure DevOps proxy
│       └── ...
├── electron/
│   ├── main.ts                     # Electron main process
│   ├── preload.ts                  # Context bridge
│   ├── terminalBridge.ts           # Socket.io ↔ PTY wiring
│   ├── pty/
│   │   ├── PtyManager.ts           # CLI session spawning
│   │   └── PromptInjector.ts       # Claude stdin injection + file fallback
│   └── services/
│       ├── OrchestratorService.ts   # Hidden Copilot session
│       ├── SummaryService.ts        # AI work summaries
│       └── HandoffService.ts        # Context transfer
├── lib/
│   ├── types.ts                    # TypeScript types + socket events
│   └── state/                      # State stores (globalThis-based)
├── public/
│   ├── splash.html                 # Native Electron splash
│   ├── office.png                  # Tileset for pixel RPG
│   ├── characters.png              # 24 character sprites
│   └── xterm.css                   # Terminal styles
├── server.ts                       # Custom Next.js + Socket.io server
└── package.json
```

### Cache Files (~/.agentmatrix/)
```
~/.agentmatrix/
├── names.json                          # Session name ↔ ID mapping
├── tasks.json                          # App task board state
├── active-sessions.json                # Sessions to auto-resume
├── settings.json                       # User preferences
├── orchestrator.json                   # Orchestrator session ID
├── ado.json                            # ADO org + project config
├── output/<sessionId>.txt              # Temp: Claude prompt-injection fallback
├── tasks/<sid>-<tid>.md                # Temp: task assignment file
└── handoffs/<id>.md                    # Temp: context transfer doc
```

---

## Session Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Spawning: User clicks "New Session"
    Spawning --> Idle: PTY ready (❯ prompt detected)
    Idle --> Working: Hook: PreToolUse
    Working --> Idle: Hook: Stop
    Working --> Working: Hook: PostToolUse → PreToolUse
    Idle --> Meeting: Hook: SubagentStart
    Meeting --> Idle: Hook: SubagentStop (all agents done)
    Working --> Meeting: Hook: SubagentStart (while working)

    Idle --> Exited: Session killed or crashed
    Working --> Exited: Session killed
    Meeting --> Exited: Session killed

    Exited --> [*]

    state "Auto-Resume" as AR
    [*] --> AR: App restart
    AR --> Idle: Session reconnected
```

---

## Terminal Data Flow

```mermaid
sequenceDiagram
    participant User as User (Browser)
    participant XTerm as xterm.js
    participant Socket as Socket.io
    participant Bridge as Terminal Bridge
    participant PTY as node-pty
    participant CLI as CLI Binary

    User->>XTerm: Keystroke
    XTerm->>Socket: terminal:input {sessionId, data}
    Socket->>Bridge: Route to PTY
    Bridge->>PTY: pty.write(data)
    PTY->>CLI: stdin

    CLI->>PTY: stdout (response)
    PTY->>Bridge: onData callback
    Bridge->>Socket: terminal:data {sessionId, data}
    Socket->>XTerm: Write to terminal
    XTerm->>User: Rendered output

    Note over Bridge: Legacy Claude panel strips select clear codes;<br/>Copilot panel is raw alt-screen passthrough
```

---

## Claude Prompt-Injection Fallback Flow

```mermaid
sequenceDiagram
    participant App as Agent Matrix
    participant PTY as PTY (Claude fallback)
    participant Claude as Claude CLI
    participant File as ~/.agentmatrix/output/<id>.txt

    App->>PTY: Check for ❯ prompt (ready state)
    App->>File: Delete old output file (if exists)
    App->>PTY: Write augmented prompt + \r
    Note over App,PTY: "Summarize work. Write output<br/>to ~/.agentmatrix/output/<id>.txt<br/>using Bash tool."

    Claude->>Claude: Processes prompt
    Claude->>File: Writes output via Bash tool

    loop Every 2 seconds (max 45s)
        App->>File: Check if file exists
    end

    App->>File: Read contents
    App->>File: Delete temp file
    App->>App: Parse and use result
```

---

## Context Transfer (Handoff)

```mermaid
sequenceDiagram
    participant User as User
    participant App as Agent Matrix
    participant Source as Source Session
    participant File as Handoff File
    participant Target as New Session

    User->>App: Click "Transfer Context"
    User->>App: Configure: name, CWD, model, permissions
    User->>App: Select knowledge to transfer
    App->>Source: Inject summary prompt via PTY
    Note over Source: "Summarize your work focusing on<br/>[selected topics]. Write to handoff file."
    Source->>File: Writes handoff-<id>.md

    App->>App: Spawn new session with config
    App->>Target: Wait 8s for session ready
    App->>Target: Inject "Read handoff file and internalize"
    Target->>File: Reads handoff document
    Target->>Target: Internalizes context

    App->>File: Cleanup handoff file
    App->>User: "Transfer complete"
```

---

*These documents describe Agent Matrix as it exists today. For each subsystem's full details, see the individual design documents linked above.*
