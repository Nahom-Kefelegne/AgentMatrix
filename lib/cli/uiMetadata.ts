import type { PermissionMode } from './CliProvider';

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

export const COPILOT_MODELS: ModelOption[] = [
  { value: '', label: 'Default' },
  { value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
  { value: 'gpt-5', label: 'GPT-5' },
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'gemini-3-pro', label: 'Gemini 3 Pro' },
];

export const COPILOT_PERMISSION_MODES: PermissionMode[] = [
  { value: 'default', label: 'Default', desc: 'Ask before risky actions' },
  { value: 'bypassPermissions', label: 'YOLO', desc: 'Allow all tools and paths' },
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

// ── Pure-string helpers (safe in browser) ─────────────────────────

/**
 * Build the resume shell command for a session. Mirrors the server
 * provider's `buildResumeShellCommand` but lives here because UI
 * components need it before any HTTP round-trip is worth it.
 *
 * Keep in sync with ClaudeProvider / CopilotProvider behavior.
 */
export function buildResumeShellCommand(opts: {
  cliType: 'claude' | 'copilot';
  resumeId: string;
  fork?: boolean;
}): string {
  if (opts.cliType === 'copilot') {
    return `copilot --resume ${opts.resumeId}`;
  }
  const parts = ['claude', '--resume', opts.resumeId, '--dangerously-skip-permissions'];
  if (opts.fork) parts.push('--fork-session');
  return parts.join(' ');
}
