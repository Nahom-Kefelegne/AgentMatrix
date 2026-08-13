import type { CliType, PermissionMode } from './CliProvider';

/**
 * Pure data tables describing each CLI's UI surface (model picker,
 * permission-mode buttons, mode toggles). Lives in its own module
 * because both providers (server-side, Node) and UI components
 * (client-side, browser) need to read these — and the provider class
 * files pull in `child_process`/`fs` at their top level, which breaks
 * client bundles.
 *
 * Keep this file dependency-free: no Node imports, no React.
 */

export interface ModelOption {
  value: string;
  label: string;
}

/** Reasoning-effort levels shared across CLIs (both expose --effort /
 *  --reasoning-effort with the same value space). */
export const EFFORT_LEVELS: ModelOption[] = [
  { value: '', label: 'Default' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

// ── Claude ────────────────────────────────────────────────────────

export const CLAUDE_MODELS: ModelOption[] = [
  { value: '', label: 'Default' },
  { value: 'opus', label: 'Opus (Latest)' },
  { value: 'sonnet', label: 'Sonnet (Latest)' },
  { value: 'haiku', label: 'Haiku (Latest)' },
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
];

export const CLAUDE_PERMISSION_MODES: PermissionMode[] = [
  { value: 'default', label: 'Default', desc: 'Ask for each tool use' },
  { value: 'bypassPermissions', label: 'Skip Permissions', desc: 'Auto-approve everything' },
  { value: 'acceptEdits', label: 'Accept Edits', desc: 'Auto-approve file edits, ask for others' },
  { value: 'plan', label: 'Plan Mode', desc: 'Plan only, no execution' },
  { value: 'auto', label: 'Auto', desc: 'Let Claude decide when to ask' },
];

// ── Copilot ───────────────────────────────────────────────────────

// Mirrors Copilot CLI's own /model picker (captured from the live 1.0.72 TUI).
// IMPORTANT: Copilot's --model flag expects DOTTED ids (e.g. `gpt-5.4`,
// `claude-sonnet-4.5`) — the previous dashed ids (`gpt-5`, `claude-sonnet-4-5`)
// were rejected by the CLI as "not available". All ids below were verified
// accepted by `copilot --model <id>`.
export const COPILOT_MODELS: ModelOption[] = [
  { value: '', label: 'Default' },
  { value: 'auto', label: 'Auto' },
  { value: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
  { value: 'claude-sonnet-4.6', label: 'Claude Sonnet 4.6' },
  { value: 'claude-sonnet-4.5', label: 'Claude Sonnet 4.5' },
  { value: 'claude-haiku-4.5', label: 'Claude Haiku 4.5' },
  { value: 'claude-opus-4.8', label: 'Claude Opus 4.8' },
  { value: 'claude-opus-4.7', label: 'Claude Opus 4.7' },
  { value: 'claude-opus-4.6', label: 'Claude Opus 4.6' },
  { value: 'claude-opus-4.5', label: 'Claude Opus 4.5' },
  { value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
  { value: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
  { value: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
  { value: 'gpt-5.5', label: 'GPT-5.5' },
  { value: 'gpt-5.4', label: 'GPT-5.4' },
  { value: 'gpt-5.3-codex', label: 'GPT-5.3-Codex' },
  { value: 'gpt-5.4-mini', label: 'GPT-5.4 mini' },
  { value: 'gpt-5-mini', label: 'GPT-5 mini' },
  { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (Preview)' },
  { value: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
  { value: 'mai-code-1-flash-picker', label: 'MAI-Code-1-Flash' },
];

export const COPILOT_PERMISSION_MODES: PermissionMode[] = [
  { value: 'default', label: 'Default', desc: 'Ask before risky actions' },
  { value: 'bypassPermissions', label: 'YOLO', desc: 'Allow all tools and paths' },
];

// ── Kimi ──────────────────────────────────────────────────────────

/**
 * Kimi Code CLI's built-in managed model aliases, from its reference config
 * (`kimi-code/k3` is the documented `default_model`). NOT exhaustive: Kimi's
 * model list is user-extensible via config.toml and `/provider` imports.
 */
export const KIMI_MODELS: ModelOption[] = [
  { value: '', label: 'Default' },
  { value: 'kimi-code/k3', label: 'Kimi K3' },
  { value: 'kimi-code/kimi-for-coding', label: 'Kimi for Coding' },
  { value: 'kimi-code/kimi-for-coding-highspeed', label: 'Kimi for Coding (High Speed)' },
];

/**
 * Kimi exposes `--yolo`/`-y` and `--auto` (documented as mutually exclusive)
 * plus `--plan`. There is deliberately NO `acceptEdits` entry — Claude's mode of
 * that name has no Kimi counterpart, and mapping it to something approximate
 * would silently grant the wrong permissions.
 */
export const KIMI_PERMISSION_MODES: PermissionMode[] = [
  { value: 'default', label: 'Default', desc: 'Ask before each tool use' },
  { value: 'bypassPermissions', label: 'YOLO', desc: 'Auto-approve regular tool calls' },
  { value: 'auto', label: 'Auto', desc: 'Let Kimi handle approvals automatically' },
  { value: 'plan', label: 'Plan Mode', desc: 'Start in Plan mode (read-only exploration)' },
];

// ── Codex ─────────────────────────────────────────────────────────

/**
 * OpenAI Codex CLI model ids, from the official model list at
 * https://learn.chatgpt.com/docs/models (the page developers.openai.com/codex/
 * models redirects to). `gpt-5.6-sol` is documented as the default.
 *
 * NOT exhaustive and NOT stable: Codex removed its hardcoded presets — the
 * comment in codex-rs/models-manager/src/model_presets.rs reads "Hardcoded
 * model presets were removed; model listings are now derived from the active
 * catalog" — so the real list is whatever `codex debug models` prints on the
 * installed version and account. This is the published set at the time of
 * writing; `''` means "omit --model" so Codex's own default applies.
 *
 * `gpt-5.4` and `gpt-5.4-mini` are documented as retiring 2026-08-31. They are
 * listed because they still work until then; drop them once they stop.
 */
export const CODEX_MODELS: ModelOption[] = [
  { value: '', label: 'Default' },
  { value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
  { value: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
  { value: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
  { value: 'gpt-5.3-codex-spark', label: 'GPT-5.3 Codex Spark' },
  { value: 'gpt-5.5', label: 'GPT-5.5' },
  { value: 'gpt-5.4', label: 'GPT-5.4' },
  { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
];

/**
 * Codex splits approval and sandboxing across two independent flags, both
 * verified in codex-rs/utils/cli/src/:
 *   --sandbox / -s            read-only | workspace-write | danger-full-access
 *   --ask-for-approval / -a   untrusted | on-request | never
 * plus `--dangerously-bypass-approvals-and-sandbox` (alias `--yolo`), which
 * turns both off at once.
 *
 * The modes below each map onto ONE of those, so nothing here is a blend of
 * flags invented to look like another CLI's mode. 'default' emits no flag at
 * all: Codex chooses its own pairing by detecting version control on startup
 * (workspace-write + on-request inside a repo, read-only outside one), and
 * overriding that from here would be strictly worse-informed.
 *
 * There is deliberately NO `acceptEdits` and no `plan` entry — Claude's and
 * Kimi's modes of those names have no Codex counterpart, and `danger-full-
 * access` is reachable through the bypass entry rather than as its own sandbox
 * value (a sandbox-off mode that still pauses for approval is a footgun with no
 * caller).
 */
export const CODEX_PERMISSION_MODES: PermissionMode[] = [
  { value: 'default', label: 'Default', desc: 'Let Codex pick sandbox + approvals for the folder' },
  { value: 'read-only', label: 'Read Only', desc: 'Sandbox: read only, no writes or commands' },
  { value: 'workspace-write', label: 'Workspace Write', desc: 'Sandbox: writes confined to the workspace' },
  { value: 'never-ask', label: 'Never Ask', desc: 'Stay sandboxed, but never pause for approval' },
  { value: 'bypassPermissions', label: 'YOLO', desc: 'No sandbox and no approvals (--yolo)' },
];

export interface CopilotMode {
  value: string;
  label: string;
  desc: string;
}

/** Copilot's --mode flag (Interactive / Plan / Autopilot). Claude has
 *  no equivalent — the closest are Claude's permission modes. */
export const COPILOT_MODES: CopilotMode[] = [
  { value: 'interactive', label: 'Interactive', desc: 'Back-and-forth, approve each action' },
  { value: 'plan', label: 'Plan', desc: 'Build structured plan before executing' },
  { value: 'autopilot', label: 'Autopilot', desc: 'Work autonomously end-to-end' },
];

// These switch exhaustively rather than using a `=== 'copilot' ? … : …`
// ternary: with four providers a binary test silently hands the newcomer
// Claude's tables, which is how a new CLI ends up offering models it can't run.

export function modelsForCli(cliType: CliType): ModelOption[] {
  switch (cliType) {
    case 'copilot': return COPILOT_MODELS;
    case 'kimi': return KIMI_MODELS;
    case 'codex': return CODEX_MODELS;
    default: return CLAUDE_MODELS;
  }
}

export function permissionModesForCli(cliType: CliType): PermissionMode[] {
  switch (cliType) {
    case 'copilot': return COPILOT_PERMISSION_MODES;
    case 'kimi': return KIMI_PERMISSION_MODES;
    case 'codex': return CODEX_PERMISSION_MODES;
    default: return CLAUDE_PERMISSION_MODES;
  }
}

/**
 * Codex is deliberately NOT given 'bypassPermissions' as its default. Its
 * bypass flag is literally named `--dangerously-bypass-approvals-and-sandbox`
 * and turns the sandbox off entirely; Claude's `--dangerously-skip-permissions`
 * only skips prompts. Defaulting Codex to it would silently drop a protection
 * layer nobody asked to drop. 'default' lets Codex pick sandbox + approvals by
 * detecting version control, which is the better-informed choice anyway.
 */
export function defaultPermissionModeForCli(cliType: CliType): string {
  switch (cliType) {
    case 'claude': return 'bypassPermissions';
    default: return 'default';
  }
}

/**
 * Which launch controls a CLI actually honours. Rendering a control the CLI
 * ignores is worse than hiding it: the user sets an effort level or a tool
 * allow-list, the flag is never passed, and nothing signals that it was
 * dropped. Kimi documents no `--effort`, no per-tool allow-list flag, and no
 * `--append-system-prompt` (see KimiProvider's buildSpawnArgs notes), and
 * neither does Codex — verified against codex-rs/utils/cli/src/
 * shared_options.rs, which is the complete flag set shared by `codex` and
 * `codex exec`. Codex's reasoning effort exists only as the config key
 * `model_reasoning_effort`, reachable through the generic `-c key=value`
 * override, and the accepted value slugs for it are unverified — so the effort
 * control stays hidden rather than emitting a guess.
 */
export interface CliUiCapabilities {
  /** `--effort` / `--reasoning-effort`. */
  effort: boolean;
  /** A per-tool allow-list flag. */
  allowedTools: boolean;
  /** `--append-system-prompt` or equivalent. */
  appendSystemPrompt: boolean;
  /** Copilot's `--mode` (Interactive / Plan / Autopilot). */
  agentMode: boolean;
}

const CLI_UI_CAPABILITIES: Record<CliType, CliUiCapabilities> = {
  claude: { effort: true, allowedTools: true, appendSystemPrompt: true, agentMode: false },
  copilot: { effort: true, allowedTools: true, appendSystemPrompt: false, agentMode: true },
  kimi: { effort: false, allowedTools: false, appendSystemPrompt: false, agentMode: false },
  codex: { effort: false, allowedTools: false, appendSystemPrompt: false, agentMode: false },
};

export function uiCapabilitiesForCli(cliType: CliType): CliUiCapabilities {
  return CLI_UI_CAPABILITIES[cliType] ?? CLI_UI_CAPABILITIES.claude;
}

/**
 * The full set of CLI types, as runtime values. Kept next to the tables above
 * so adding a provider means touching one list, not hunting down every
 * hand-rolled `x === 'claude' || x === 'copilot'` narrowing check.
 */
export const CLI_TYPES: CliType[] = ['claude', 'copilot', 'kimi', 'codex'];

/**
 * Narrow untrusted input (HTTP payloads, socket messages, persisted state) to a
 * CliType. Use this instead of inlining an equality chain: the inlined version
 * silently returns `undefined` for any provider added later, which callers then
 * quietly turn back into 'claude'.
 */
export function isCliType(value: unknown): value is CliType {
  return typeof value === 'string' && (CLI_TYPES as string[]).includes(value);
}

export function validOptionValue<T extends { value: string }>(
  options: T[],
  value: string | undefined,
  fallback = '',
): string {
  return value && options.some(option => option.value === value) ? value : fallback;
}

// ── Pure-string helpers (safe in browser) ─────────────────────────

/**
 * Build the resume shell command for a session. Mirrors the server
 * provider's `buildResumeShellCommand` but lives here because UI
 * components need it before any HTTP round-trip is worth it.
 *
 * Keep in sync with ClaudeProvider / CopilotProvider behavior.
 */
export function buildResumeShellCommand(opts: {
  cliType: CliType;
  resumeId: string;
  fork?: boolean;
}): string {
  switch (opts.cliType) {
    case 'copilot':
      return `copilot --resume ${opts.resumeId}`;
    // Kimi resumes with `--session <id>`; it has no --fork-session equivalent
    // (`/fork` is TUI-only), so `fork` is intentionally ignored here.
    case 'kimi':
      return `kimi --session ${opts.resumeId}`;
    // Codex resumes and forks with SUBCOMMANDS, not flags: `codex resume <id>`
    // and `codex fork <id>` are siblings with the same argument shape. Keep in
    // sync with buildCodexResumeArgs in lib/cli/CodexProvider.ts.
    case 'codex':
      return `codex ${opts.fork ? 'fork' : 'resume'} ${opts.resumeId}`;
    default: {
      const parts = ['claude', '--resume', opts.resumeId, '--dangerously-skip-permissions'];
      if (opts.fork) parts.push('--fork-session');
      return parts.join(' ');
    }
  }
}
