# Agent Matrix — Multi-CLI Support Design Document

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

### Phase 1: Abstract & Refactor (no new features, pure refactor)

1. Create `CliProvider` interface
2. Extract `ClaudeProvider` from existing hardcoded logic
3. Thread provider through PtyManager, OutputParser, SessionScanner
4. Verify all existing functionality works identically

**Risk:** Low — pure refactor, no behavior change.

### Phase 2: Add CopilotProvider (basic support)

1. Implement `CopilotProvider` — binary detection, spawn args, session discovery
2. Update setup scripts to detect and configure both CLIs
3. Add CLI selector to Spawn Modal
4. Add `cliType` to SessionData
5. Test: spawn, resume, and interact with Copilot sessions

**Risk:** Medium — new CLI integration, may hit undocumented behaviors.

### Phase 3: SDK Integration (replace prompt injection for Claude)

1. Install `@anthropic-ai/claude-agent-sdk`
2. Create `SdkBridge` service that wraps `query()` for programmatic tasks
3. Replace PromptInjector usage in SummaryService, HandoffService, OrchestratorService
4. Keep PTY for interactive terminal sessions

**Risk:** Medium — SDK is actively developed, API may change. But eliminates the most fragile part of our codebase.

### Phase 4: ACP Integration (structured communication for Copilot)

1. Create `AcpBridge` service that communicates via `copilot --acp --stdio`
2. Use for Copilot sessions' programmatic tasks (summaries, task assignment)
3. Potentially use for hook-equivalent events (tool use tracking without repo-level hooks)

**Risk:** Medium-high — ACP is newer, less documented.

### Phase 5: Polish & Unification

1. Unified hook normalization layer
2. CLI-specific model lists in Spawn Modal
3. Session badge showing CLI type
4. Documentation and setup guide updates
5. Cross-CLI context transfer (Claude session → Copilot session)

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

1. **Copilot user-level hooks** — Does Copilot support hooks outside of `.github/hooks/`? If not, we need ACP or per-repo setup.
2. **Copilot session ID format** — Is it a UUID like Claude's? Affects session scanner and resume logic.
3. **Copilot subagent detection** — No `SubagentStart/Stop` hooks. Can we detect agents via ACP events or PTY output parsing?
4. **Cross-CLI context transfer** — Can we transfer context from a Claude session to a Copilot session? The handoff file is CLI-agnostic (markdown), but the "read this file" instruction would differ.
5. **Copilot prompt indicator** — Exact character/pattern for detecting prompt ready state. Needs testing with a real Copilot CLI session.
6. **Claude Agent SDK stability** — The SDK has 159 versions with near-daily releases. Pin to a specific version?
