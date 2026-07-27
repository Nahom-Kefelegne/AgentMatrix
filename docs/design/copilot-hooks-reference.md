# GitHub Copilot CLI Hooks — Authoritative Reference

**Sources:** [`docs.github.com/en/copilot/concepts/agents/hooks`](https://docs.github.com/en/copilot/concepts/agents/hooks), [`docs.github.com/en/copilot/reference/hooks-reference`](https://docs.github.com/en/copilot/reference/hooks-reference), [`docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-hooks`](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-hooks), [github.com/github/copilot-cli changelog](https://github.com/github/copilot-cli/blob/main/changelog.md)

---

## A. Complete Hook Event Table

The official reference ([hooks-reference](https://docs.github.com/en/copilot/reference/hooks-reference)) confirms **13 documented events**. The system supports two naming conventions simultaneously:
- **camelCase format** (e.g., `sessionStart`) → fields use camelCase
- **PascalCase / VS Code-compatible format** (e.g., `SessionStart`) → fields use `snake_case` with a `hook_event_name` discriminator

> **Your candidate list analysis:** All 12 candidates were confirmed. `Error` maps to `errorOccurred`/`ErrorOccurred`. One **new event you did NOT list** was found: `postToolUseFailure` / `PostToolUseFailure`.

| # | camelCase name | PascalCase alias | Fires When | Output Processed? | Blocks / Modifies? | CLI Only? |
|---|---|---|---|---|---|---|
| 1 | `sessionStart` | `SessionStart` | New or resumed session begins | ✅ Optional | Injects `additionalContext` into session | No (both CLI and cloud agent) |
| 2 | `sessionEnd` | `SessionEnd` | Session terminates | ❌ No | None | No |
| 3 | `userPromptSubmitted` | `UserPromptSubmit`¹ | User submits a prompt | ❌ No (officially) | See Note² | No |
| 4 | `preToolUse` | `PreToolUse` | Before each tool executes | ✅ Yes — **most powerful** | Can `allow`, `deny`, or `ask`; can substitute `modifiedArgs`. **Fail-closed** on command error | No |
| 5 | `postToolUse` | `PostToolUse` | After each tool completes **successfully** | ✅ Yes | Can `modifiedResult` or inject `additionalContext` | No |
| 6 | `postToolUseFailure` | `PostToolUseFailure` | After a tool completes with **failure** | ✅ Yes (exit code 2) | Injects `additionalContext` as recovery guidance | No |
| 7 | `agentStop` | `Stop` | Main agent finishes a turn | ✅ Yes | `"block"` forces another turn using `reason` as next prompt | No |
| 8 | `subagentStart` | *(no PascalCase alias)* | Subagent spawned (before it runs) | ✅ Optional | `additionalContext` prepended to subagent's prompt. Cannot block creation | No |
| 9 | `subagentStop` | `SubagentStop` | Subagent completes | ✅ Yes | `"block"` forces another turn | No |
| 10 | `errorOccurred` | `ErrorOccurred` | Any error during execution | ❌ No | None (logging only) | No |
| 11 | `preCompact` | `PreCompact` | Context compaction is about to begin (manual or auto) | ❌ No | Notification only; `matcher` on `trigger` (`"manual"`/`"auto"`) | No (auto-only under cloud agent) |
| 12 | `notification` | *(uses `hook_event_name: "Notification"`)* | CLI emits a system notification (async) | ✅ Optional | Injects `additionalContext` into session. **Fire-and-forget: never blocks** | ✅ **CLI only** |
| 13 | `permissionRequest` | `PermissionRequest` | Before permission service runs (before rule checks, session approvals, user prompt) | ✅ Yes | `"allow"` or `"deny"` short-circuits permission flow. `interrupt: true` stops agent entirely | ✅ **CLI only** |

**Notes:**

1. **`UserPromptSubmit` vs `UserPromptSubmitted`:** The PascalCase alias is `UserPromptSubmit` (not `UserPromptSubmitted`). The camelCase name is `userPromptSubmitted`. This asymmetry is intentional in the docs.

2. **`userPromptSubmitted` output:** The official reference events table says "No" for output processing. However, the changelog contains two entries suggesting evolving capability: *"Include userPromptSubmitted hook additionalContext in the model-facing prompt"* and *"userPromptSubmitted hooks can now handle requests directly, bypassing the LLM and returning a response without making a model call."* This appears to be a newer feature not yet reflected in the reference table. ⚠️ **Not officially documented in the reference schema** — use with caution.

3. **Undocumented changelog-only event:** `preMcpToolCall` appears once in the changelog (*"Add preMcpToolCall hook for hook providers to control outgoing MCP request metadata"*) but is **absent from the official reference page**. It may be an internal/plugin-provider-only hook. Do not rely on it.

4. **`subagentStart` note:** The built-in `general-purpose` agent does **not** emit `subagentStart` or `subagentStop`. All other built-in YAML-based agents (`explore`, `task`, `code-review`, `rubber-duck`, `research`, `security-review`) and user-defined custom agents do emit these events.

---

## B. Config File Format & Discovery Locations

### B1. JSON Schema

Three hook types are supported: `command`, `http`, and `prompt`.

#### `command` hook (default, cross-platform)
```json
{
  "version": 1,
  "disableAllHooks": false,
  "hooks": {
    "preToolUse": [
      {
        "type": "command",
        "bash": "YOUR_BASH_COMMAND_OR_SCRIPT_PATH",
        "powershell": "YOUR_POWERSHELL_COMMAND",
        "command": "CROSS_PLATFORM_FALLBACK",
        "cwd": "relative/or/absolute/path",
        "env": { "KEY": "VALUE" },
        "timeoutSec": 30,
        "timeout": 30,
        "matcher": "bash|edit"
      }
    ]
  }
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `type` | `"command"` | No (defaults to `"command"`) | |
| `bash` | string | One of `bash`, `powershell`, or `command` | Unix shell command |
| `powershell` | string | One of `bash`, `powershell`, or `command` | Windows PowerShell command |
| `command` | string | One of `bash`, `powershell`, or `command` | Cross-platform fallback — copied to both when `bash`/`powershell` absent |
| `cwd` | string | No | Relative to repo root, or absolute |
| `env` | object | No | Merged with existing environment; supports variable expansion |
| `timeoutSec` | number | No | Default: `30`. Takes precedence over `timeout` |
| `timeout` | number | No | Alias for `timeoutSec` when `timeoutSec` absent |
| `matcher` | string | No | Regex anchored as `^(?:PATTERN)$`. Available on: `preToolUse`, `postToolUse`, `permissionRequest` (on `toolName`), `subagentStart` (on `agentName`), `preCompact` (on `trigger`), `notification` (on `notification_type`) |

#### `http` hook
```json
{
  "version": 1,
  "hooks": {
    "postToolUse": [
      {
        "type": "http",
        "url": "https://hooks.example.com/copilot",
        "headers": { "Authorization": "Bearer $MY_TOKEN", "X-Source": "copilot-cli" },
        "allowedEnvVars": ["MY_TOKEN"],
        "timeoutSec": 30,
        "matcher": "bash|edit"
      }
    ]
  }
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `type` | `"http"` | **Yes** | Must be `"http"` |
| `url` | string | Yes | HTTPS required for `preToolUse` and `permissionRequest` (response can grant permissions). Localhost HTTP allowed with `COPILOT_HOOK_ALLOW_LOCALHOST=1` |
| `headers` | object | No | Request headers. Supports `$ENV_VAR` expansion for vars listed in `allowedEnvVars` |
| `allowedEnvVars` | string[] | No | Vars that may be expanded inside `headers` values |
| `timeoutSec` | number | No | Default: `30` |
| `timeout` | number | No | Alias for `timeoutSec` |
| `matcher` | string | No | Same as command hook |

> **Fail behavior for HTTP:** HTTP `preToolUse` hooks are **fail-open** — network errors, timeouts, or non-2xx responses fall through to the default permission flow. This is the opposite of command hooks (which are fail-closed on error). Choose based on your security requirements.

#### `prompt` hook (only on `sessionStart`)
```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [
      {
        "type": "prompt",
        "prompt": "/compact focus on recent security changes"
      }
    ]
  }
}
```

> Only fires for **new interactive sessions**. Does not fire on resume or in non-interactive `-p` mode.

---

### B2. Config File Discovery Locations (CLI — all sources merged)

The CLI loads hooks from ALL these sources in order; when the same event appears in multiple sources, **all entries from all sources run**:

| Priority | Location | Notes |
|---|---|---|
| 1 (highest) | **Policy-level** (machine-wide, admin-only): Linux/macOS: `/etc/github-copilot/policy.d/*.json`; Windows: `C:\ProgramData\GitHub\Copilot\policy.d\*.json`; also Windows Registry: `HKLM\Software\Policies\GitHub\Copilot` | Cannot be disabled by `disableAllHooks`. Must be owned by root on POSIX, not group/world-writable |
| 2 | **Repository-level**: `.github/hooks/*.json` | Multiple `*.json` files, all loaded |
| 3 | **User-level**: `~/.copilot/hooks/*.json` (macOS/Linux), `%USERPROFILE%\.copilot\hooks\*.json` (Windows). Override with `COPILOT_HOME`: `$COPILOT_HOME/hooks/*.json` | Your `~/.copilot/hooks/agentmatrix.json` is here ✅ |
| 4 | **Inline `hooks` block** in: `.github/copilot/settings.json`, `.github/copilot/settings.local.json`, `.claude/settings.json`, `.claude/settings.local.json` (all repo-level) | Cross-tool Claude Code compatibility |
| 5 | **Inline `hooks` block** in: `~/.copilot/settings.json` | User-level settings file |
| 6 | **Plugin hooks**: each plugin's `hooks.json` or `hooks/hooks.json` inside the plugin install dir | Lowest priority |

> **`version` field:** Was previously required (`"version": 1`). A changelog entry states: *"Hooks config files that omit the version field are now accepted by the CLI"* — but `"version": 1` remains the correct and recommended value.

> **`disableAllHooks`:** Set at top level of any config file. When in a single file: only hooks in that file are skipped. When in `settings.json` at repo level: ALL hooks from all sources are skipped for that repo (policy hooks still run). Does not affect cloud agent.

---

## C. Per-Event Payload and Response Schemas

All payloads are sent as the stdin to command hooks, or as the JSON body of the HTTP POST. PascalCase event names use `snake_case` fields + `hook_event_name`; camelCase names use camelCase fields.

### `sessionStart` / `SessionStart`

**Input (camelCase):**
```typescript
{
  sessionId: string;
  timestamp: number;          // Unix ms
  cwd: string;
  source: "startup" | "resume" | "new";
  initialPrompt?: string;
}
```

**Input (PascalCase/VS Code-compatible):**
```typescript
{
  hook_event_name: "SessionStart";
  session_id: string;
  timestamp: string;          // ISO 8601
  cwd: string;
  source: "startup" | "resume" | "new";
  initial_prompt?: string;
}
```

**Response (stdout / HTTP response body):**
```typescript
{
  additionalContext?: string;  // Injected into the session conversation
}
```

---

### `sessionEnd` / `SessionEnd`

**Input (camelCase):**
```typescript
{
  sessionId: string;
  timestamp: number;
  cwd: string;
  reason: "complete" | "error" | "abort" | "timeout" | "user_exit";
}
```

**Input (PascalCase):**
```typescript
{
  hook_event_name: "SessionEnd";
  session_id: string;
  timestamp: string;
  cwd: string;
  reason: "complete" | "error" | "abort" | "timeout" | "user_exit";
}
```

**Response:** None processed.

---

### `userPromptSubmitted` / `UserPromptSubmit`

**Input (camelCase):**
```typescript
{
  sessionId: string;
  timestamp: number;
  cwd: string;
  prompt: string;
}
```

**Input (PascalCase):**
```typescript
{
  hook_event_name: "UserPromptSubmit";
  session_id: string;
  timestamp: string;
  cwd: string;
  prompt: string;
}
```

**Response:** Officially "No" per reference table. Changelog entries suggest `additionalContext` may be injectable and the hook may be able to bypass the LLM entirely — but this is **not formally documented** in the reference schema.

---

### `preToolUse` / `PreToolUse`

**Input (camelCase):**
```typescript
{
  sessionId: string;
  timestamp: number;
  cwd: string;
  toolName: string;   // e.g., "bash", "view", "edit"
  toolArgs: unknown;  // Parsed tool arguments
}
```

**Input (PascalCase — uses Claude tool names):**
```typescript
{
  hook_event_name: "PreToolUse";
  session_id: string;
  timestamp: string;
  cwd: string;
  tool_name: string;   // Claude tool name (e.g., "Bash", "Read", "Edit")
  tool_input: unknown; // Tool arguments (parsed from JSON string when possible)
}
```

**Claude tool name mapping (for PascalCase hooks):**

| Runtime tool name | Claude tool name |
|---|---|
| `bash`, `powershell` | `Bash` |
| `view` | `Read` |
| `create` | `Write` |
| `edit`, `str_replace_editor`, `apply_patch` | `Edit` |
| `grep`, `rg` | `Grep` |
| `glob` | `Glob` |
| `web_fetch` | `WebFetch` |
| `web_search` | `WebSearch` |
| `ask_user` | `AskUserQuestion` |
| `update_todo` | `TodoWrite` |
| `task` | `Agent` (also accepts `Task`) |

**PascalCase `PreToolUse` matcher semantics** (Claude-format):
- `*`, `**`, or empty `matcher` → fires for every tool
- Literal name or `|`-separated alternation (e.g., `Bash` or `Edit|Write`) → fires when any token equals the Claude tool name
- Other values → treated as case-sensitive regex `^(?:PATTERN)$`

**Response (stdout / HTTP body):**
```typescript
{
  permissionDecision?: "allow" | "deny" | "ask";
  permissionDecisionReason?: string;  // Required when denying; shown to agent
  modifiedArgs?: object;              // Substitute tool arguments
}
```

**Fail behavior:**
- Command hooks: **Fail-closed on non-zero exit (non-timeout)** → denies tool with `"Denied by preToolUse hook (hook errored)"`. Timeout = fail-open (warning surfaced, proceeds to normal permission flow).
- HTTP hooks: **Fail-open** — network error/timeout/non-2xx → falls through to default permission flow.

**Progress messages:** Hooks may emit intermediate status lines during long-running checks:
```bash
echo '{"type": "progress", "message": "Checking policy...", "temporary": true}'
# ...work...
echo '{"permissionDecision": "deny", "permissionDecisionReason": "Blocked by security policy"}'
```

---

### `postToolUse` / `PostToolUse`

**Input (camelCase):**
```typescript
{
  sessionId: string;
  timestamp: number;
  cwd: string;
  toolName: string;
  toolArgs: unknown;
  toolResult: {
    resultType: "success";
    textResultForLlm: string;
  };
}
```

**Input (PascalCase):**
```typescript
{
  hook_event_name: "PostToolUse";
  session_id: string;
  timestamp: string;
  cwd: string;
  tool_name: string;
  tool_input: unknown;
  tool_result: {
    result_type: "success";
    text_result_for_llm: string;
  };
}
```

**Response:**
```typescript
{
  modifiedResult?: {
    resultType: "success";
    textResultForLlm: string;
  };
  additionalContext?: string;  // Appended to textResultForLlm; capped at 10KB across all hooks
}
```

Return `{}` or empty to keep the original result. Multiple hooks' `additionalContext` values are joined with double newline.

**Matcher:** Optional regex on `toolName` (e.g., `"matcher": "bash|edit"`).

> ⚠️ **Important:** `postToolUse` only fires after **successful** tool calls. Use `postToolUseFailure` for failures.

---

### `postToolUseFailure` / `PostToolUseFailure`

**Input (camelCase):**
```typescript
{
  sessionId: string;
  timestamp: number;
  cwd: string;
  toolName: string;
  toolArgs: unknown;
  error: string;
}
```

**Input (PascalCase):**
```typescript
{
  hook_event_name: "PostToolUseFailure";
  session_id: string;
  timestamp: string;
  cwd: string;
  tool_name: string;
  tool_input: unknown;
  error: string;
}
```

**Response:** Exit code `2` → treated as `additionalContext`; stdout is appended to the failure shown to the agent. Return empty for default failure behavior.

---

### `agentStop` / `Stop`

**Input (camelCase):**
```typescript
{
  sessionId: string;
  timestamp: number;
  cwd: string;
  transcriptPath: string;
  stopReason: "end_turn";
}
```

**Input (PascalCase — note: PascalCase alias is `Stop`):**
```typescript
{
  hook_event_name: "Stop";
  session_id: string;
  timestamp: string;
  cwd: string;
  transcript_path: string;
  stop_reason: "end_turn";
}
```

**Response:**
```typescript
{
  decision?: "block" | "allow";
  reason?: string;  // Required when decision is "block" — used as prompt for the next agent turn
}
```

---

### `subagentStart` *(camelCase only — no PascalCase alias)*

**Input:**
```typescript
{
  sessionId: string;
  timestamp: number;
  cwd: string;
  transcriptPath: string;
  agentName: string;
  agentDisplayName?: string;
  agentDescription?: string;
}
```

**Response:**
```typescript
{
  additionalContext?: string;  // Prepended to the subagent's prompt
}
```

**Matcher:** Optional regex on `agentName`.

---

### `subagentStop` / `SubagentStop`

**Input (camelCase):**
```typescript
{
  sessionId: string;
  timestamp: number;
  cwd: string;
  transcriptPath: string;
  agentName: string;
  agentDisplayName?: string;
  stopReason: "end_turn";
}
```

**Input (PascalCase):**
```typescript
{
  hook_event_name: "SubagentStop";
  session_id: string;
  timestamp: string;
  cwd: string;
  transcript_path: string;
  agent_name: string;
  agent_display_name?: string;
  stop_reason: "end_turn";
}
```

**Response:** Same as `agentStop` — `decision: "block"` + `reason` forces another subagent turn.

---

### `errorOccurred` / `ErrorOccurred`

**Input (camelCase):**
```typescript
{
  sessionId: string;
  timestamp: number;
  cwd: string;
  error: {
    message: string;
    name: string;
    stack?: string;
  };
  errorContext: "model_call" | "tool_execution" | "system" | "user_input";
  recoverable: boolean;
}
```

**Input (PascalCase):**
```typescript
{
  hook_event_name: "ErrorOccurred";
  session_id: string;
  timestamp: string;
  cwd: string;
  error: {
    message: string;
    name: string;
    stack?: string;
  };
  error_context: "model_call" | "tool_execution" | "system" | "user_input";
  recoverable: boolean;
}
```

**Response:** None processed.

---

### `preCompact` / `PreCompact`

**Input (camelCase):**
```typescript
{
  sessionId: string;
  timestamp: number;
  cwd: string;
  transcriptPath: string;
  trigger: "manual" | "auto";
  customInstructions: string;
}
```

**Input (PascalCase):**
```typescript
{
  hook_event_name: "PreCompact";
  session_id: string;
  timestamp: string;
  cwd: string;
  transcript_path: string;
  trigger: "manual" | "auto";
  custom_instructions: string;
}
```

**Response:** None processed (notification only).

**Matcher:** Optional regex on `trigger` (`"manual"` or `"auto"`).

---

### `notification` *(always uses `hook_event_name: "Notification"` regardless of config casing)*

**Input:**
```typescript
{
  sessionId: string;
  timestamp: number;
  cwd: string;
  hook_event_name: "Notification";
  message: string;            // Human-readable notification text
  title?: string;             // Short title e.g. "Permission needed", "Shell completed"
  notification_type: string;  // One of the types below
}
```

**`notification_type` values:**

| Type | When it fires |
|---|---|
| `shell_completed` | A background shell command finishes |
| `shell_detached_completed` | A detached shell session completes |
| `agent_completed` | A background subagent finishes (completed or failed) |
| `agent_idle` | A background agent finishes a turn and enters idle state (waiting for `write_agent`) |
| `permission_prompt` | The agent requests permission to execute a tool |
| `elicitation_dialog` | The agent requests additional information from the user |

**Response:**
```typescript
{
  additionalContext?: string;  // Injected as a prepended user message into the session
}
```

> **Fire-and-forget:** Never blocks the session. Errors are logged and skipped. If `additionalContext` is returned while the session is idle, it can trigger further agent processing.

**Matcher:** Optional regex on `notification_type`.

---

### `permissionRequest` / `PermissionRequest`

> **CLI only** — does not fire under cloud agent (tools are pre-approved there; use `preToolUse` instead).

This hook fires **before** the normal permission service (rule checks, session approvals, auto-allow/deny, user prompting). Particularly useful in `-p` pipe/CI mode where no interactive prompt is available.

**Input payload:** Not explicitly documented as a formal schema in the reference. The matcher operates on `toolName`, so the payload includes at minimum `toolName`. Based on the context it is analogous to `preToolUse`. ⚠️ **Treat as undocumented schema.**

**PascalCase `PermissionRequest` matcher:** Uses same Claude-format matcher semantics as PascalCase `PreToolUse`.

**Response (stdout / HTTP body):**
```typescript
{
  behavior?: "allow" | "deny";
  message?: string;     // Reason fed back to the LLM when denying
  interrupt?: boolean;  // When true + "deny" → stops the agent entirely
}
```

Return empty or `{}` to fall through to normal permission handling.

**Exit code 2** for command hooks: Treated as `{"behavior": "deny"}`; stdout JSON (if any) is merged in; stderr is ignored.

---

## D. Version & Availability Notes

### Hooks introduction timeline (reconstructed from changelog):

All hooks were introduced during the **v1.0.x** series, after the GA announcement (*"To commemorate GitHub Copilot CLI reaching general availability last week, we're incrementing the major version to 1.0!"*). The exact build versions per entry are not tagged in the changelog, but the sequence is clear:

| Feature | When (sequence in changelog) |
|---|---|
| Basic hooks (repo `.github/hooks/` + user `~/.copilot/hooks/`) | At/around v1.0 GA |
| `command` type (`bash`/`powershell` fields), `timeoutSec`, `type: "command"` as cross-platform alias | v1.0 GA |
| PascalCase event names for VS Code compatibility (snake_case payloads) | Shortly after v1.0 |
| `type: "http"` hook support | After v1.0 |
| `postToolUseFailure` (separate from postToolUse) | Alongside HTTP hooks |
| `permissionRequest` hook | After HTTP hooks |
| `notification` hook (async, fire-and-forget) | After permissionRequest |
| `subagentStart` hook | After notification |
| `preCompact` hook | After subagentStart |
| `prompt` hook type for `sessionStart` | After preCompact |
| `disableAllHooks` flag | Recent (v1.0.4x+) |
| Progress messages (`{"type":"progress"}`) from command hooks | Recent |
| Policy hooks (`/etc/github-copilot/policy.d/`) | Recent |
| `preMcpToolCall` | Very recent (changelog only, not in reference docs) |

**Changelog entries directly relevant to your installed version (1.0.67–1.0.69):**

- *"Stop hooks from erroring and denying every tool when a session's working directory or git worktree has been deleted"*
- *"Allow tool calls to continue when hooks time out"* (previously may have been fail-closed on timeout)
- *"Inline hook settings now handle nested Claude-style hook groups correctly"*
- *"Hook progress status lines marked as temporary collapse in place instead of accumulating in the conversation timeline"*
- *"preToolUse hook errors now deny the tool call instead of silently allowing execution"* (confirms fail-closed)
- *"PostToolUse hook matchers (e.g. `Edit|Write`) are now honored instead of silently dropped"*
- *"Claude-format plugin `preToolUse` and `permissionRequest` hooks now fire correctly for tool matchers like `Bash`, `Read`, and `*`"*
- *"Forward typed rejection feedback from preToolUse prompts to the model"*
- *"preToolUse hook permissionDecision 'allow' now suppresses the tool approval prompt"*
- *"Hooks (preToolUse, postToolUse, subagentStart, subagentStop) now fire correctly for sub-agent tool calls"*

---

## E. Your Config File — Validation

```json
{"version":1,"hooks":{"SessionStart":[{"type":"http","url":"...","timeoutSec":2}]}}
```

| Field | Valid? | Notes |
|---|---|---|
| `"version": 1` | ✅ | Correct |
| `"SessionStart"` (PascalCase) | ✅ | Supported; payload will use `snake_case` + `hook_event_name: "SessionStart"` |
| `"type": "http"` | ✅ | Supported |
| `"url": "..."` | ✅ | For `sessionStart`, HTTP is acceptable (only `preToolUse` and `permissionRequest` require HTTPS) |
| `"timeoutSec": 2` | ✅ | Overrides the 30s default. 2s is tight but valid |
| Missing `"headers"` | ✅ | Optional |
| Missing `"matcher"` | ✅ | Optional (receives all sessionStart events) |

**What the CLI will POST to your URL:** The `SessionStart` input payload in snake_case:
```json
{
  "hook_event_name": "SessionStart",
  "session_id": "...",
  "timestamp": "2026-07-07T20:49:56.252Z",
  "cwd": "/path/to/current/dir",
  "source": "startup",
  "initial_prompt": "optional initial prompt if any"
}
```

**What it expects back:** A JSON body (or empty) with optional `additionalContext`:
```json
{
  "additionalContext": "Optional text to inject into the session"
}
```

Return `{}` or HTTP 200 with empty body to take no action.

---

## F. AgentMatrix Fail-Open Policy

AgentMatrix hooks observe session activity; they never make policy decisions.

- `PreToolUse` uses a command handler only because Copilot rejects localhost HTTP
  for permission-capable hooks.
- The command discards the response body, forces exit code zero, limits curl to
  one second, and has a two-second Copilot timeout.
- `/api/hooks/tool-use` acknowledges with HTTP 202 before doing session-state or
  telemetry work.
- Setup/update scripts do not duplicate the Copilot template. The running app
  owns `~/.copilot/hooks/agentmatrix.json` and refreshes it before sessions start.

This keeps AgentMatrix off the tool execution critical path: missing, slow, or
failing telemetry may be dropped, but the underlying tool continues.

---

## G. Gaps and Uncertainties

| Item | Status |
|---|---|
| `permissionRequest` **input** payload schema | ⚠️ **Not explicitly documented** in the reference page. Only the output/response schema is shown. The `matcher` runs on `toolName`, implying it's in the payload. Use `preToolUse` payload as a guide. |
| `userPromptSubmitted` output/response schema | ⚠️ **Conflicting info** — reference table says "No output processed"; changelog says `additionalContext` and LLM-bypass are supported. Not formally documented in the schema section. |
| `preMcpToolCall` | ⚠️ **Changelog-only** — appears once as *"Add preMcpToolCall hook for hook providers to control outgoing MCP request metadata"* but has NO entry in the official reference. Likely an internal/plugin-SDK hook not intended for end users. |
| Exact version numbers per hook event | ⚠️ The changelog has no per-entry version tags, only sequential ordering. All hooks appear in the v1.0.x series. |
| `notification` always uses `hook_event_name: "Notification"` | ✅ Explicitly confirmed — the notification hook uses a fixed snake_case payload regardless of how it's configured in the JSON key. |
| Cloud agent hook support | ✅ Confirmed: `notification` and `permissionRequest` are **CLI-only**. All other events fire in both. `preToolUse` `"ask"` decision → treated as `"deny"` under cloud agent (no user available). |

(agent_id: copilot-hooks-research — use write_agent to send follow-up messages)