# AgentMatrix Repository and Runtime Flow Map

Status: **Current architecture overview**

This document is the visual entry point for understanding where AgentMatrix
code lives and how the major runtime flows connect.

## 1. Repository Structure

```mermaid
flowchart TB
    Repo["AgentMatrix repository"]

    Repo --> App["app/<br/>Next.js routes, React UI, Canvas renderers"]
    Repo --> Electron["electron/<br/>Desktop lifecycle, PTYs, IPC, Socket bridge"]
    Repo --> Lib["lib/<br/>Contracts, state, services, providers, engine"]
    Repo --> MCP["mcp-server/<br/>AgentMatrix MCP schemas and stdio server"]
    Repo --> Public["public/<br/>Static assets and splash screen"]
    Repo --> Scripts["scripts/<br/>Dependency and setup utilities"]
    Repo --> Docs["docs/<br/>Designs, plans, handoffs, architecture"]

    App --> Api["app/api/<br/>Trusted HTTP boundaries"]
    App --> Components["app/components/<br/>Control Center, Office, terminals, Canvas"]
    App --> Styles["app/styles/<br/>Feature-scoped visual contracts"]

    Lib --> Canvas["lib/canvas/<br/>Typed Canvas protocol, validation, retention"]
    Lib --> Navigation["lib/navigation/<br/>Root-scoped file and diff navigation"]
    Lib --> State["lib/state/<br/>Sessions, settings, names, tasks, caches"]
    Lib --> Cli["lib/cli/<br/>Claude/Copilot provider behavior"]
    Lib --> Engine["lib/engine/<br/>Pixel Office simulation and rendering"]
```

## 2. Runtime Process Topology

```mermaid
flowchart LR
    subgraph Desktop["Electron desktop process"]
        Main["electron/main.ts<br/>BrowserWindow + app lifecycle"]
        PTY["PtyManager<br/>node-pty session processes"]
        Bridge["terminalBridge<br/>Socket events to/from PTYs"]
        Preload["electron/preload.ts<br/>narrow renderer IPC"]
    end

    subgraph Server["Next.js custom server"]
        Http["HTTP / API routes"]
        Socket["Socket.io"]
        ServerState["globalThis state stores"]
    end

    subgraph Renderer["React renderer"]
        Shell["Control Center shell"]
        Console["SessionConsole / xterm"]
        Office["OfficeWorkspace"]
        Context["Context Canvas"]
    end

    subgraph Sessions["Managed CLI processes"]
        Copilot["Copilot / Agency Copilot"]
        Claude["Claude Code"]
        AgentMCP["AgentMatrix MCP stdio process"]
    end

    Main --> Http
    Main --> Preload
    Main --> PTY
    PTY <--> Copilot
    PTY <--> Claude
    Bridge <--> PTY
    Bridge <--> Socket
    Http <--> ServerState
    Socket <--> ServerState
    Socket <--> Shell
    Shell --> Console
    Shell --> Office
    Shell --> Context
    AgentMCP --> Http
    Copilot --> AgentMCP
    Claude --> AgentMCP
```

## 3. Session Activity Flow

CLI hooks and PTY events update one authoritative session model, then fan out to
the Control Center and Office.

```mermaid
sequenceDiagram
    participant CLI as Copilot / Claude
    participant Hook as app/api/hooks/*
    participant Store as lib/state/sessionStore
    participant Socket as Socket.io
    participant React as useSocket / DashboardV2
    participant Office as OfficeCanvas / GameEngine

    CLI->>Hook: session, prompt, tool, agent, stop event
    Hook->>Store: add or update SessionData
    Hook->>Socket: emit typed session event
    Socket->>React: update sessions Map
    Socket->>Office: raw event callback while Office is mounted
    React->>React: rank attention and render session rail
    Office->>Office: update character without root React rendering
```

The Office raw-event path exists for animation performance. Initial Office
mount still hydrates from the current React `sessions` Map so existing parents
and subagents are present before new events arrive.

## 4. Control Center Workspace Flow

Dashboard and Office share one shell. Only one expensive main workspace renders
at a time.

```mermaid
stateDiagram-v2
    [*] --> ControlCenter
    ControlCenter --> Office: Office nav
    Office --> ControlCenter: Open CLI / Control Center nav
    ControlCenter --> Editor: hidden editor shortcut
    Editor --> ControlCenter: close editor

    state ControlCenter {
        SessionRail
        ConsoleWorkspace
        ContextCanvas
    }

    state Office {
        SharedSessionRail
        LazyOfficeWorkspace
        OfficeSelectionStrip
    }
```

Performance boundary:

- `OfficeWorkspace` and `GameEngine` are dynamically loaded.
- Office unmounts before `ConsoleWorkspace` mounts.
- Office renders at 30 FPS locally or 12 FPS in reduced/remote mode.
- explicit Electron hide/minimize suspends Office at zero frames.

## 5. Context Canvas Request Flow

```mermaid
sequenceDiagram
    participant Agent as Managed coding agent
    participant MCP as mcp-server/index.mjs
    participant Route as POST /api/canvas/request
    participant Validate as lib/canvas/requests.ts
    participant Retain as lib/canvas/requestStore.ts
    participant Socket as canvas:requested
    participant Reducer as useContextCanvas
    participant Renderer as ContextCanvas

    Agent->>MCP: present_* / request_decision / update_plan
    MCP->>Route: kind + bounded typed arguments
    Route->>Route: verify session capability
    Route->>Validate: validate schema, paths, ranges, URL
    Validate-->>Route: host-authored CanvasRequest
    Route->>Retain: retain or replace by kind
    Route->>Socket: emit accepted request
    Socket->>Reducer: selected / background / pinned policy
    Reducer->>Renderer: active typed artifact
```

Security ownership:

- session identity comes from the managed MCP process environment
- tool arguments cannot choose a session or repository root
- unknown fields are rejected
- repository paths are canonicalized under the registered root
- models provide data and intent, never arbitrary HTML or layout

## 6. Plan Canvas Flow

Plan is the first Canvas artifact with true silent same-kind replacement in the
visible client history.

```mermaid
flowchart LR
    Tool["update_plan"]
    Schema["MCP item schema<br/>id, label, status, summary?"]
    Validate["planItem validation<br/>1-100 unique IDs"]
    Retain["requestStore<br/>replace retained Plan"]
    Reducer{"Canvas protected?"}
    Queue["replace queued Plan"]
    Replace["replace active Plan<br/>mutate current history slot"]
    Render["PlanArtifact<br/>progress + execution rail"]
    State["stable item IDs<br/>expanded row + scroll anchor"]

    Tool --> Schema --> Validate --> Retain --> Reducer
    Reducer -- "background / pinned / human content" --> Queue
    Reducer -- "selected + unprotected" --> Replace
    Replace --> Render --> State
```

The Plan renderer is read-only:

- progress is derived from item statuses
- one optional step summary is expanded at a time
- updates do not grow Canvas history
- the newest queued Plan replaces an older queued Plan
- stable IDs preserve disclosure and scroll state
- Plan never edits the durable Task Board

## 7. Decision Response Flow

Decision is the primary Canvas flow that travels back from the renderer into
the originating CLI.

```mermaid
sequenceDiagram
    participant Agent as Session agent
    participant Canvas as DecisionArtifact
    participant Api as POST /api/canvas/decision
    participant Delivery as decisionResponses
    participant PTY as PtyManager

    Agent->>Canvas: request_decision
    Canvas->>Api: selected option or custom answer
    Api->>Delivery: validate retained pending request
    Delivery->>PTY: sendPrompt()
    PTY-->>Delivery: resolve after actual PTY write
    Delivery-->>Canvas: retained resolution receipt
    PTY->>Agent: continue from user decision
```

## 8. Session-Selected Review Flow

```mermaid
sequenceDiagram
    participant Agent as Managed session
    participant MCP as present_changes
    participant Capture as Review snapshot service
    participant Git as Session worktree + Git objects
    participant Store as Bounded snapshot store
    participant Canvas as DiffCanvas / SessionDiffCore
    participant API as Renderer-token review API

    Agent->>MCP: scope=selection + exact files + optional baseRef
    MCP->>Capture: capability-bound session identity
    Capture->>Git: resolve root, HEAD, base, selected paths
    Git-->>Capture: host-authoritative original/current bytes
    Capture->>Store: atomic frozen snapshot + content hashes
    Capture-->>Canvas: file manifest + provenance + opaque file IDs
    Canvas->>API: load selected frozen file by fileId
    API->>Store: lease and retrieve content
    Store-->>Canvas: immutable original/current diff
```

The session selects **what** matters. AgentMatrix owns **how** evidence is
resolved, bounded, frozen, authenticated, expired, and marked stale.

## 9. File-Change to Markdown Preview Flow

```mermaid
flowchart LR
    Tool["Write / Edit / apply_patch"]
    Hook["successful file-change hook"]
    Event["session:files-changed"]
    Cache["useNavigationFile invalidation"]
    Policy{"Selected and unprotected?"}
    Preview["MarkdownPreview"]
    Queue["session Canvas queue"]

    Tool --> Hook --> Event --> Cache --> Policy
    Policy -- Yes --> Preview
    Policy -- "background / pinned / human artifact" --> Queue
```

Only validated `docs/design/*.md` changes auto-preview. Source remains
available through Monaco, and Markdown is sanitized before rendering.

## 10. Where to Make Changes

| Goal | Primary files |
|---|---|
| Add a Canvas request kind | `lib/canvas/types.ts`, `lib/canvas/requests.ts`, `mcp-server/index.mjs` |
| Add a Canvas renderer | `canvasArtifact.ts`, `ContextCanvas.tsx`, a new `*Artifact.tsx`, `context-canvas.css` |
| Change queue/history/pin behavior | `useContextCanvas.ts` |
| Change MCP selection guidance | `mcp-server/instructions.mjs`, tool descriptions, `lib/constants/mcpPrompt.ts` |
| Change session lifecycle | `electron/pty/PtyManager.ts`, `electron/terminalBridge.ts`, `lib/state/sessionStore.ts` |
| Change Control Center layout | `DashboardV2*.tsx`, `mission-control.css` |
| Change Office behavior | `OfficeWorkspace.tsx`, `OfficeCanvas.tsx`, `lib/engine/*`, `office.css` |
| Change Markdown security | `MarkdownPreview.tsx`, `markdown.ts`, navigation link routes |
| Change selected review capture | `lib/review/*`, `app/api/canvas/review/*`, `DiffCanvas.tsx`, `SessionDiffCore.tsx` |
| Change provider launch behavior | `lib/cli/*Provider.ts`, `electron/pty/PtyManager.ts` |
| Change persistent app state | `lib/state/*`, `~/.agentmatrix/*` path helpers |

## 11. Reading Order for New Contributors

1. `docs/design/repository-flow-map.md`
2. `docs/design/dashboard-v2.md`
3. `docs/plans/context-canvas-ui-foundation.md`
4. `docs/plans/context-canvas-agent-tools.md`
5. `docs/plans/context-canvas-components.md`
6. `docs/design/electron-pty.md`
7. `docs/design/backend-server.md`
