# Agent Matrix — Multi-CLI Support Design Document

> **Note:** Claude Agent SDK is not available to users. All Claude integration must use the CLI binary directly (PTY or `--output-format stream-json` flags). Copilot integration can use the built-in ACP protocol (`copilot --acp --stdio`).

## Overview

Agent Matrix currently only supports Claude Code CLI. This design adds support for **GitHub Copilot CLI** while keeping Claude Code as the primary provider. The architecture abstracts all CLI-specific behavior behind a `CliProvider` interface, making it straightforward to add future CLI agents.

## Research Findings

### Claude Code — Programmatic APIs Available

The `@anthropic-ai/claude-agent-sdk` (v0.2.109) provides a full programmatic interface:

- **`query()` function** — Spawns Claude as subprocess, communicates via NDJSON over stdin/stdout. Returns `AsyncGenerator<SDKMessage>` with typed events (assistant, tool_use, result, system).
- **`--output-format stream-json`** — CLI flag for structured JSON output (no TUI).
- **`--input-format stream-json`** — Accepts structured input on stdin (bidirectional).
- **Session management** — `listSessions()`, `getSessionInfo()`, `forkSession()`, `renameSession()`.
- **27 hook events** — Including `FileChanged`, `TaskCreated`, `TaskCompleted`, `TeammateIdle`, `WorktreeCreate`.
- **SDK hooks** — JavaScript callbacks (not just shell commands) with bidirectional responses.
- **MCP server creation** — `createSdkMcpServer()` for in-process tool providers.
- **Control methods** — `interrupt()`, `setPermissionMode()`, `setModel()`, `getContextUsage()`, `rewindFiles()`.

**Impact:** The SDK can replace our PTY-based prompt injection for programmatic tasks (summaries, task assignment, orchestrator queries). Sessions could optionally run in SDK mode for structured communication while keeping the TUI terminal for interactive use.

### GitHub Copilot CLI

- **Binary:** `copilot` (installed via npm, Homebrew, WinGet, or install script)
- **Sessions:** Persistent, stored in `~/.copilot/session-state/` with SQLite index
- **Resume:** `copilot --resume <id>` or `copilot --continue` (most recent)
- **Permissions:** `--allow-all-tools` / `--yolo` (equivalent to `--dangerously-skip-permissions`)
- **Models:** Multi-model (Claude Sonnet/Opus, GPT-5, Gemini 3 Pro, etc.)
- **Hooks:** 6 events configured in `.github/hooks/*.json` (repo-level, not user-level)
  - `sessionStart`, `sessionEnd`, `preToolUse`, `postToolUse`, `userPromptSubmitted`, `errorOccurred`
  - Hooks receive JSON on stdin with `session_id`, `tool_name`, `tool_input`
- **ACP Protocol:** `copilot --acp --stdio` starts JSON-RPC server over stdin/stdout (NDJSON)
- **Multi-agent:** `/fleet` command for parallel agents, custom agent definitions
- **Config:** `~/.copilot/config.json`, `~/.copilot/mcp-config.json`
- **Reads `CLAUDE.md`** natively from repo root

### Compatibility Matrix

| Feature | Claude Code | Copilot CLI | Abstraction Needed |
|---------|------------|-------------|-------------------|
| Binary name | `claude` | `copilot` | Yes |
| Config dir | `~/.claude/` | `~/.copilot/` | Yes |
| Session resume | `--resume <id>` | `--resume <id>` | Minimal |
| Skip permissions | `--dangerously-skip-permissions` | `--yolo` | Yes |
| Model select | `--model <name>` | `--model <name>` | Same flag |
| Effort | `--effort <level>` | `--reasoning-effort <level>` | Yes |
| Hooks config | `~/.claude/settings.json` | `.github/hooks/*.json` | Yes |
| Hook events | PascalCase (PreToolUse) | camelCase (preToolUse) | Normalize |
| Hook payload | `session_id`, `tool_name`, `tool_input` | Same fields | Compatible |
| Session storage | `projects/<path>/<id>.jsonl` | `session-state/<id>/events.jsonl` | Yes |
| Prompt indicator | `❯` or `>` | Git branch glyph | Yes |
| Context display | `XX% remaining` | Different format | Yes |
| Programmatic API | SDK (`query()`) + `stream-json` | ACP (`--acp --stdio`) | Abstract |
| System prompt | `--append-system-prompt` | Custom instructions file | Different |
| Fork session | `--resume <id> --fork-session` | Unknown | Claude-only for now |
| Subagent hooks | `SubagentStart/Stop` | No equivalent | Claude-only |

---

## Architecture

### CliProvider Interface

```typescript
// lib/cli/CliProvider.ts

interface CliProviderConfig {
  type: 'claude' | 'copilot';
  binaryPath?: string;  // Override auto-detection
}

interface SpawnOptions {
  cwd: string;
  sessionId?: string;     // For new sessions (Claude only — Copilot auto-assigns)
  permissionMode?: string;
  model?: string;
  effort?: string;
  allowedTools?: string;
  systemPrompt?: string;
}

interface ResumeOptions {
  cwd: string;
  resumeId: string;
  fork?: boolean;
}

interface SessionInfo {
  id: string;
  name: string;
  cwd: string;
  lastModified: number;
  transcriptPath?: string;
}

interface CliProvider {
  readonly type: 'claude' | 'copilot';
  readonly configDir: string;           // ~/.claude or ~/.copilot

  // Binary
  findBinary(): string;

  // Spawn arguments
  buildSpawnArgs(opts: SpawnOptions): string[];
  buildResumeArgs(opts: ResumeOptions): string[];

  // Session discovery
  discoverSessions(cwd?: string): Promise<SessionInfo[]>;
  findSessionCwd(sessionId: string): string | undefined;

  // PTY output parsing
  detectPromptReady(text: string): boolean;
  parseContextUsage(text: string): number | null;

  // Hook configuration
  configureHooks(hookUrls: Record<string, string>): Promise<void>;
  getHookEventMap(): Record<string, string>;  // Maps our events to CLI-specific names

  // Process detection
  detectActiveProcesses(): string[];  // Returns session IDs of running CLI processes
}
```

### Provider Implementations

#### ClaudeProvider

```typescript
// lib/cli/ClaudeProvider.ts

class ClaudeProvider implements CliProvider {
  type = 'claude' as const;
  configDir = join(homedir(), '.claude');

  findBinary() {
    // Try PATH first, then known install locations
    // which claude / where claude
    // Fallback: ~/.local/bin/claude, /usr/local/bin/claude, etc.
  }

  buildSpawnArgs(opts) {
    const args = [];
    if (opts.sessionId) args.push('--session-id', opts.sessionId);
    if (opts.permissionMode === 'bypassPermissions') args.push('--dangerously-skip-permissions');
    else if (opts.permissionMode) args.push('--permission-mode', opts.permissionMode);
    if (opts.model) args.push('--model', opts.model);
    if (opts.effort) args.push('--effort', opts.effort);
    if (opts.systemPrompt) args.push('--append-system-prompt', opts.systemPrompt);
    return args;
  }

  buildResumeArgs(opts) {
    const args = ['--resume', opts.resumeId, '--dangerously-skip-permissions'];
    if (opts.fork) args.push('--fork-session');
    return args;
  }

  discoverSessions(cwd?) {
    // Scan ~/.claude/projects/<encoded-cwd>/*.jsonl
    // Parse first line of each for metadata
  }

  detectPromptReady(text) {
    return /[>\u276F]\s*$/.test(stripAnsi(text));
  }

  parseContextUsage(text) {
    // Match "XX% remaining" or "XX% used"
  }

  configureHooks(hookUrls) {
    // Write to ~/.claude/settings.json hooks section
    // Uses cat | curl pattern (macOS/Linux) or curl.exe (Windows)
  }

  detectActiveProcesses() {
    // ps aux | grep '[c]laude.*--session-id'
  }
}
```

#### CopilotProvider

```typescript
// lib/cli/CopilotProvider.ts

class CopilotProvider implements CliProvider {
  type = 'copilot' as const;
  configDir = join(homedir(), '.copilot');

  findBinary() {
    // which copilot / where copilot
    // Fallback: npm global, Homebrew, WinGet paths
  }

  buildSpawnArgs(opts) {
    const args = [];
    // No --session-id equivalent (auto-assigned)
    if (opts.permissionMode === 'bypassPermissions') args.push('--yolo');
    if (opts.model) args.push('--model', opts.model);
    if (opts.effort) args.push('--reasoning-effort', opts.effort);
    if (opts.cwd) args.push('--cwd', opts.cwd);
    return args;
  }

  buildResumeArgs(opts) {
    return ['--resume', opts.resumeId];
    // No --yolo on resume (Copilot remembers permission state)
    // No --fork-session equivalent
  }

  discoverSessions(cwd?) {
    // Read ~/.copilot/session-store.db (SQLite)
    // Or scan ~/.copilot/session-state/*/workspace.yaml
  }

  detectPromptReady(text) {
    // Copilot uses a different prompt indicator (git branch glyph)
    // Need to identify the exact pattern
    return /[$❯›]\s*$/.test(stripAnsi(text));
  }

  parseContextUsage(text) {
    // Copilot has different context display format
    // Need to identify the pattern
  }

  configureHooks(hookUrls) {
    // Write to .github/hooks/agentmatrix.json in current repo
    // Or create a global hook config
    // Uses bash/powershell command format
  }

  detectActiveProcesses() {
    // ps aux | grep '[c]opilot' or equivalent
  }
}
```

### Provider Factory

```typescript
// lib/cli/index.ts

type CliType = 'claude' | 'copilot';

function getProvider(type: CliType): CliProvider {
  switch (type) {
    case 'claude': return new ClaudeProvider();
    case 'copilot': return new CopilotProvider();
  }
}

function detectInstalledCLIs(): CliType[] {
  const installed: CliType[] = [];
  try { execSync('which claude || where claude', { stdio: 'pipe' }); installed.push('claude'); } catch {}
  try { execSync('which copilot || where copilot', { stdio: 'pipe' }); installed.push('copilot'); } catch {}
  return installed;
}

function getActiveProvider(): CliProvider {
  // Read from app settings (agentmatrix-settings.json)
  // Fallback: first installed CLI
}
```

---

## Integration Points — What Changes

### 1. PtyManager (electron/pty/PtyManager.ts)

**Current:** Hardcoded `claude` binary, Claude-specific flags.

**New:** Takes a `CliProvider` instance, delegates to it:

```typescript
class PtyManager {
  constructor(private provider: CliProvider) {}

  private findClaudeBinary() → this.provider.findBinary()

  spawnNew(id, opts) {
    const args = this.provider.buildSpawnArgs(opts);
    return this.spawnPty(opts.cwd, args);
  }

  spawnResume(id, opts) {
    const args = this.provider.buildResumeArgs(opts);
    return this.spawnPty(cwd, args);
  }
}
```

### 2. OutputParser (electron/pty/OutputParser.ts)

**Current:** Hardcoded `❯` prompt detection and `XX% remaining` context parsing.

**New:** Delegates to provider:

```typescript
class OutputParser {
  constructor(private provider: CliProvider) {}

  isPromptReady(text) { return this.provider.detectPromptReady(text); }
  parseContextUsage(text) { return this.provider.parseContextUsage(text); }
}
```

### 3. SessionScanner (lib/state/sessionScanner.ts)

**Current:** Scans `~/.claude/projects/`, parses `.jsonl`, greps `ps aux` for `claude`.

**New:** Delegates to provider:

```typescript
function startSessionScanner(provider: CliProvider, callback) {
  const sessions = await provider.discoverSessions();
  const active = provider.detectActiveProcesses();
  // Rest stays the same
}
```

### 4. Hook API Routes (app/api/hooks/*)

**No changes needed.** Both CLIs send JSON with the same essential fields (`session_id`, `tool_name`, `tool_input`). The routes are already generic.

One addition: normalize event names. Copilot sends `preToolUse` (camelCase) while Claude sends `PreToolUse` (PascalCase). The setup scripts already handle this by mapping to the correct route URL.

### 5. Setup Scripts (setup.sh, setup.ps1)

**Current:** Only configures Claude hooks.

**New:** Detect which CLIs are installed, configure hooks for each:

```bash
# Detect CLIs
HAS_CLAUDE=0; HAS_COPILOT=0
command -v claude &>/dev/null && HAS_CLAUDE=1
command -v copilot &>/dev/null && HAS_COPILOT=1

# Configure Claude hooks (in ~/.claude/settings.json)
if [ $HAS_CLAUDE -eq 1 ]; then
  # existing hook configuration...
fi

# Configure Copilot hooks (in .github/hooks/agentmatrix.json per repo)
# Note: Copilot hooks are repo-level, not global
# We create a template that users copy to their repos
if [ $HAS_COPILOT -eq 1 ]; then
  write_copilot_hook_template()
fi
```

### 6. Spawn Modal (app/components/SpawnModal.tsx)

**New:** Add CLI selector dropdown (if multiple CLIs installed):

```
┌─ New Session ──────────────────────┐
│ CLI: [Claude ▾] [Copilot ▾]       │
│ Name: _______________              │
│ CWD:  _______________              │
│ Model: [Claude Opus 4.6 ▾]        │
│ Permission: [Default ▾]           │
│ ...                                │
└────────────────────────────────────┘
```

Model list changes based on selected CLI.

### 7. App Settings (app/components/AppSettingsModal.tsx)

**New:** CLI configuration section:

- Default CLI selector
- Per-CLI binary path override
- Detected CLIs list with status

### 8. Session Dialog (app/components/SessionDialog.tsx)

**No major changes.** Sessions already carry their type. The dialog renders the terminal, which is CLI-agnostic (it's just a PTY). Tool tracking, file changes, and task assignment all work through hooks which are already normalized.

Minor: Show which CLI a session is using (small badge/icon in the header).

---

## Eliminating Hacky PTY Prompt Injection

### Current: PromptInjector

Our current approach for programmatic communication (summaries, task assignment, orchestrator queries):

1. Wait for prompt ready (`❯`) by polling PTY output
2. Write instruction text to PTY stdin
3. Wait 1 second for TUI to process
4. Send Enter (`\r`)
5. Poll for output file on disk

**Problems:** Timing-sensitive, fragile, blocks the terminal, user sees the injected prompt, cleanup needed.

### New: SDK/ACP Structured Communication

#### For Claude: Use the Agent SDK

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

// Programmatic query — no PTY needed
async function askClaude(prompt: string, sessionId?: string) {
  const result = query({
    prompt,
    options: {
      sessionId,  // Continue existing session context
      maxTurns: 1,
      permissionMode: 'bypassPermissions',
    }
  });

  let response = '';
  for await (const msg of result) {
    if (msg.type === 'assistant') {
      response += msg.message.content.map(c => c.type === 'text' ? c.text : '').join('');
    }
  }
  return response;
}
```

**Use for:** Summary generation, task assignment, orchestrator queries, context handoff summaries.

**Keep PTY for:** Interactive terminal sessions (user typing in the console).

#### For Copilot: Use ACP Protocol

```typescript
// Spawn copilot in ACP mode for programmatic tasks
const proc = spawn('copilot', ['--acp', '--stdio'], { cwd });

// Send JSON-RPC request
proc.stdin.write(JSON.stringify({
  jsonrpc: '2.0',
  method: 'session.create',
  params: { prompt: 'Summarize the work done in this session' },
  id: 1,
}) + '\n');

// Read JSON-RPC response
for await (const line of readline(proc.stdout)) {
  const msg = JSON.parse(line);
  if (msg.result) return msg.result;
}
```

### Dual-Mode Sessions

Each session can operate in two modes simultaneously:

1. **Interactive mode** — PTY terminal (xterm.js) for user interaction
2. **Programmatic mode** — SDK/ACP for app-driven tasks

This eliminates prompt injection entirely. The app uses the SDK for structured tasks while the user interacts through the terminal normally. No more:
- Waiting for prompt ready
- Text appearing in the terminal that the user didn't type
- File polling for output
- Timing hacks

---

## Copilot-Specific Hook Configuration

Copilot hooks are configured at the **repo level** (`.github/hooks/`) not globally. This means:

**Option A: Global hook template**
- Setup script creates `~/.copilot/hooks/agentmatrix.json` (if Copilot supports user-level hooks)
- Needs verification — Copilot docs primarily show repo-level hooks

**Option B: Per-repo hook setup**
- Setup script creates a template file
- User copies it to each repo's `.github/hooks/` directory
- Or Agent Matrix auto-creates it when spawning a session in a new CWD

**Option C: ACP protocol instead of hooks**
- Skip hooks entirely for Copilot
- Use `copilot --acp --stdio` to get structured events
- More reliable, no per-repo configuration needed
- Requires running a background ACP session per active Copilot session

**Recommendation:** Start with **Option C** (ACP) since it's more reliable and doesn't require per-repo setup. Fall back to **Option B** if ACP is insufficient.

---

## Data Model Changes

### SessionData (lib/types.ts)

Add `cliType` field:

```typescript
interface SessionData {
  // ... existing fields
  cliType: 'claude' | 'copilot';  // Which CLI this session uses
}
```

### Settings (agentmatrix-settings.json)

Add CLI preferences:

```typescript
interface AppSettings {
  // ... existing fields
  defaultCli: 'claude' | 'copilot';
  cliOverrides?: {
    claude?: { binaryPath?: string };
    copilot?: { binaryPath?: string };
  };
}
```

---

## Implementation Phases

### Phase 1: CliProvider Skeleton + Health Checks

1. Create `CliProvider` interface (`lib/cli/CliProvider.ts`)
2. Create `ClaudeProvider` — extract existing hardcoded Claude logic (pure refactor)
3. Create `CopilotProvider` — stub implementation
4. Create factory + auto-detection (`lib/cli/index.ts`)
5. Create `/api/cli/health` route — returns installed CLIs with version/status
6. Thread provider through PtyManager, OutputParser, SessionScanner
7. Verify all existing Claude functionality works identically

**Deliverables:** Provider interface, Claude still works, health check API available.
**Risk:** Low — pure refactor + new API route.

### Phase 2: UX — CLI Selection & Visual Identity

1. Add `cliType: 'claude' | 'copilot'` to `SessionData` in `lib/types.ts`
2. Update `SpawnModal` — CLI selector with health-gated buttons, CLI-specific model lists
3. Update `AppSettingsModal` — CLI section with status, default CLI, binary paths
4. Update `DashboardView` — CLI icon on session cards
5. Update `SessionDialog` — CLI badge in header
6. Update `OfficeCanvas` HoverCard — CLI icon
7. Update `terminal:new` socket event to include `cliType`
8. Update `terminalBridge` to use provider based on `cliType`
9. Disable spawn/resume when no CLIs are detected

**Deliverables:** Full UX for multi-CLI, visual differentiation, health gates.
**Risk:** Low-medium — UI changes, no new CLI behavior yet.

### Phase 3: CopilotProvider Implementation

1. Implement `CopilotProvider.findBinary()` — detect copilot on PATH
2. Implement `CopilotProvider.buildSpawnArgs()` — `--yolo`, `--model`, `--reasoning-effort`, `--cwd`
3. Implement `CopilotProvider.buildResumeArgs()` — `--resume <id>`
4. Implement `CopilotProvider.discoverSessions()` — scan `~/.copilot/session-state/`
5. Implement `CopilotProvider.detectPromptReady()` — identify Copilot's prompt pattern
6. Implement `CopilotProvider.detectActiveProcesses()` — grep for copilot processes
7. Update setup scripts — detect Copilot, configure hooks (repo-level `.github/hooks/`)
8. Test: spawn, interact, resume Copilot sessions end-to-end

**Deliverables:** Working Copilot sessions in Agent Matrix.
**Risk:** Medium — new CLI, may need pattern tuning.

### Phase 4: Hook Normalization + Copilot Events

1. Normalize hook event names (PascalCase ↔ camelCase) in a mapping layer
2. Auto-create `.github/hooks/agentmatrix.json` in CWD when spawning Copilot session
3. Handle Copilot's `userPromptSubmitted` + `errorOccurred` events (Claude doesn't have these)
4. Handle missing `SubagentStart/Stop` for Copilot (degrade gracefully — no agent sprites)
5. Explore ACP protocol as alternative to file-based hooks for Copilot

**Deliverables:** Live tool/status updates for Copilot sessions.
**Risk:** Medium — hook compatibility needs testing.

### Phase 5: Polish & Cross-CLI Features

1. Cross-CLI context transfer (Claude → Copilot, Copilot → Claude)
2. Unified session resume (ResumeModal shows sessions from both CLIs with icons)
3. CLI-specific features: Copilot `/fleet` integration, Claude fork session
4. Documentation and setup guide updates
5. Handle edge cases (CLI uninstalled mid-session, version mismatches)

---

## UX Resilience & System Health

### CLI Health Checks

On app startup and before any session spawn, verify CLIs are available:

```typescript
// lib/cli/healthCheck.ts
interface CliHealth {
  type: 'claude' | 'copilot';
  installed: boolean;
  version: string | null;      // e.g. "2.1.79", "1.0.27"
  authenticated: boolean;      // Can the CLI actually make API calls?
  binaryPath: string | null;
  error?: string;              // Human-readable reason if not available
}

async function checkCliHealth(type: CliType): Promise<CliHealth>;
function checkAllClis(): Promise<CliHealth[]>;
```

**When checks run:**
- App startup → results cached, shown in settings
- Before spawning a session → if CLI not healthy, block spawn with clear error
- On demand from settings page (refresh button)

**How authentication is checked:**
- Claude: `claude --version` succeeds (exits 0). Auth issues show at session start, not binary check.
- Copilot: `copilot --version` succeeds. Auth via `GH_TOKEN` or OAuth — `copilot auth status` if available.

### API Route: `/api/cli/health`

New endpoint that returns health status for all detected CLIs. Called by SpawnModal and AppSettings.

```
GET /api/cli/health
→ { clis: [
    { type: 'claude', installed: true, version: '2.1.79', authenticated: true, binaryPath: '/usr/local/bin/claude' },
    { type: 'copilot', installed: false, version: null, authenticated: false, error: 'copilot not found on PATH' }
  ]}
```

### SpawnModal — CLI Selection with Health Gates

```
┌─ New Session ─────────────────────────────┐
│                                           │
│  CLI                                      │
│  ┌─────────────┐ ┌──────────────────┐     │
│  │ ● Claude    │ │ ○ Copilot (N/A)  │     │
│  │   v2.1.79   │ │   Not installed  │     │
│  └─────────────┘ └──────────────────┘     │
│                                           │
│  Working Directory                        │
│  [/Users/nahom/Desktop/DEV ▾]             │
│                                           │
│  Session Name                             │
│  [___________________________]            │
│                                           │
│  Model                                    │
│  [Claude Opus 4.6 ▾]   ← changes per CLI │
│                                           │
│  ...rest of fields...                     │
└───────────────────────────────────────────┘
```

**Rules:**
- CLI buttons are `OptionGroup` style (same pattern as permission mode)
- Uninstalled CLI is visually disabled (greyed out, not clickable)
- Shows version under the name when installed
- Shows "Not installed" or specific error when not available
- Model dropdown changes based on selected CLI:
  - Claude: Opus, Sonnet, Haiku
  - Copilot: Claude Sonnet 4.5, GPT-5, Claude Opus 4.6, Gemini 3 Pro, etc.
- If only one CLI is installed, it's auto-selected and the toggle is informational only
- Default CLI comes from AppSettings

### Dashboard Cards — CLI Icon

Each session card gets a small CLI icon in the header row:

```
┌────────────────────────────────────┐
│ [◆] my-session          Working ● │   ← ◆ = Claude icon, ⬡ = Copilot icon
│ /path/to/project                   │
│ ...                                │
└────────────────────────────────────┘
```

**Icon design:**
- Claude: `◆` (diamond) in Anthropic orange (#D97706) or a small "C" badge
- Copilot: `⬡` (hexagon) in GitHub blue (#2F81F7) or the Copilot icon
- Icon is subtle (12px, muted color) — doesn't dominate the card
- Tooltip on hover shows full CLI name + version

**Where the icon appears:**
- Dashboard session cards (left of session name)
- Session dialog header (left of session name)
- Office view hover card (next to session name)
- Fullscreen terminal tab bar (left of session name)

### Session Dialog — CLI Badge

In the session dialog header, show a small pill badge:

```
┌─ ◆ my-session ──── Claude v2.1.79 ──── IDLE ─────┐
│  Console  Tasks  Info  Settings                    │
```

Or more subtly, just the icon next to the name with tooltip.

### Error States & Edge Cases

| Scenario | UX Response |
|----------|-------------|
| No CLIs installed | Show setup instructions on dashboard. Spawn button disabled with "Install Claude or Copilot CLI to get started" |
| CLI installed but not authenticated | Allow spawn, but show warning. Auth prompt appears in the terminal naturally. |
| CLI binary found but wrong version | Show version in health check. Don't block — let user try. |
| CLI disappears mid-session (uninstalled/PATH change) | Session terminal shows exit. No special handling needed — PTY will error naturally. |
| Hooks not configured for selected CLI | Show warning toast when spawning: "Hooks not configured for {CLI}. Session will work but Agent Matrix won't receive live updates." |
| Both CLIs installed, user hasn't picked default | First CLI found becomes default. SpawnModal shows both options. |
| Session spawned with CLI that's no longer installed | Resume button shows "CLI not available" instead of spawning. Offer to re-spawn with available CLI. |
| Copilot hooks not set up for this repo | Show inline notice in session dialog: "Set up hooks for live updates" with one-click setup button. |

### AppSettingsModal — CLI Section

Add a new section at the top of settings:

```
┌─ Settings ────────────────────────────────┐
│                                           │
│  CLI Agents                               │
│  ┌─────────────────────────────────────┐  │
│  │ ● Claude Code    v2.1.79    ✓ Ready │  │
│  │   /usr/local/bin/claude             │  │
│  │   [Set as Default]                  │  │
│  ├─────────────────────────────────────┤  │
│  │ ○ GitHub Copilot  v1.0.27  ✓ Ready │  │
│  │   /usr/local/bin/copilot            │  │
│  │   [Set as Default]                  │  │
│  ├─────────────────────────────────────┤  │
│  │         [↻ Refresh Status]          │  │
│  └─────────────────────────────────────┘  │
│                                           │
│  Auto-resume sessions                     │
│  ...existing settings...                  │
└───────────────────────────────────────────┘
```

### Startup Flow

```
App starts
  → Check CLI health (parallel: claude --version, copilot --version)
  → Cache results in globalThis
  → If no CLIs found:
      → Dashboard shows "No CLI agents detected" card with install links
      → Spawn/Resume buttons disabled
  → If CLIs found:
      → Normal startup
      → Auto-resume uses the CLI type stored on each session
```

### Resume Flow — CLI Type Matching

When resuming a session, we need to know which CLI it belongs to:

- **From active sessions cache:** `cliType` is stored in `agentmatrix-active-sessions.json`
- **From session discovery:** Claude sessions are in `~/.claude/projects/`, Copilot sessions in `~/.copilot/session-state/`
- **From ResumeModal:** Show CLI icon next to each session in the list so user knows what they're resuming
- **Edge case:** If session's CLI isn't installed, show disabled with "Requires {CLI name}"

---

## What Stays Exactly The Same

These components are CLI-agnostic and need zero changes:

- Dashboard view, Office canvas, session cards
- Terminal panel (xterm.js) — just renders PTY output
- Task board, task assignment flow
- Context transfer UI (HandoffModal)
- File change tracking (ChangesViewer)
- Code review comments
- Theme system, ambient orbs, matrix rain
- Socket.io event system
- All hook route handlers (already generic)

---

## Open Questions

1. **Copilot user-level hooks** — Does Copilot support hooks outside of `.github/hooks/`? If not, we auto-create per-repo or use ACP.
2. **Copilot session ID format** — Is it a UUID like Claude's? Affects session scanner and resume logic.
3. **Copilot subagent detection** — No `SubagentStart/Stop` hooks. Graceful degradation: no agent sprites for Copilot sessions.
4. **Cross-CLI context transfer** — Handoff file is markdown (CLI-agnostic), but the "read this file" prompt differs per CLI. Provider should have a `buildReadFilePrompt(path)` method.
5. **Copilot prompt indicator** — Exact character/pattern for detecting prompt ready state. Needs testing with a real Copilot CLI session.
6. **Copilot `/fleet` integration** — Can we expose Copilot's parallel agent feature through the Agent Matrix UI?
7. **Single vs multi-CLI per workspace** — Can a user have both Claude and Copilot sessions active simultaneously? (Yes — each session carries its `cliType` and uses the right provider.)
