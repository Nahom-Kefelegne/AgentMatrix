import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';

/**
 * Generates the Copilot CLI hook configuration that wires a live session into
 * AgentMatrix's dashboard (session/tool/agent/error/notification activity).
 *
 * Why the app owns this (not just setup.sh):
 *   setup.sh writes this file too, but only for users who ran it. Generating it
 *   from the app at startup means fresh installs and dev builds get working
 *   hooks with no manual step, and the config stays in sync with the API routes.
 *
 * Handler-type strategy (see docs/design/copilot-hooks-reference.md §4):
 *   - Most events are fire-and-forget monitoring → cheap `http` hooks to
 *     http://localhost. These require COPILOT_HOOK_ALLOW_LOCALHOST=1 on the
 *     Copilot process (PtyManager sets it).
 *   - `PreToolUse` is special: Copilot rejects plain http://localhost for it
 *     even with the localhost flag (its response can grant permissions), so it
 *     must use a `command` hook that curls the payload to the app. We discard
 *     the response body (-o /dev/null) so nothing is misread as a permission
 *     decision, and `|| true` keeps it fail-open (tool proceeds normally).
 *
 * Event names are PascalCase so Copilot emits snake_case payload fields
 * (session_id, tool_name, tool_input, ...), matching the /api/hooks/* routes
 * (which are shared with the Claude hook payloads).
 */

const COPILOT_HOOKS_DIR = join(homedir(), '.copilot', 'hooks');
const CONFIG_PATH = join(COPILOT_HOOKS_DIR, 'agentmatrix.json');

// http events (PascalCase) → route path
const HTTP_EVENTS: Record<string, string> = {
  SessionStart: 'session-start',
  SessionEnd: 'session-end',
  PostToolUse: 'tool-complete',
  Stop: 'stop',
  SubagentStart: 'agent-start',
  SubagentStop: 'agent-stop',
  UserPromptSubmit: 'prompt-submit',
  ErrorOccurred: 'error',
  PostToolUseFailure: 'tool-failed',
  PreCompact: 'pre-compact',
  Notification: 'notification',
};

// command events (PascalCase) → route path (must not use http://localhost)
const COMMAND_EVENTS: Record<string, string> = {
  PreToolUse: 'tool-use',
};

interface HttpHandler { type: 'http'; url: string; timeoutSec: number }
interface CommandHandler {
  type: 'command';
  bash: string;
  powershell: string;
  timeoutSec: number;
}

export function buildCopilotHooksConfig(port: number): {
  version: number;
  hooks: Record<string, (HttpHandler | CommandHandler)[]>;
} {
  const base = `http://localhost:${port}/api/hooks`;
  const hooks: Record<string, (HttpHandler | CommandHandler)[]> = {};

  for (const [event, route] of Object.entries(HTTP_EVENTS)) {
    hooks[event] = [{ type: 'http', url: `${base}/${route}`, timeoutSec: 2 }];
  }
  for (const [event, route] of Object.entries(COMMAND_EVENTS)) {
    // Discard the response body so it can't be parsed as a permission decision;
    // force a zero exit code, and bound both curl and Copilot so a missing or
    // slow app never blocks the tool.
    const url = `${base}/${route}`;
    hooks[event] = [{
      type: 'command',
      bash: `cat | curl -s -o /dev/null --connect-timeout 1 --max-time 1 -X POST ${url} -H 'Content-Type: application/json' --data-binary @- 2>/dev/null || true`,
      powershell: `$body = [Console]::In.ReadToEnd(); try { Invoke-RestMethod -Uri '${url}' -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 1 | Out-Null } catch {}; exit 0`,
      timeoutSec: 2,
    }];
  }

  return { version: 1, hooks };
}

/**
 * Idempotently writes the hook config. Only touches disk when the content
 * changed, so it's cheap to call on every startup and avoids needless churn.
 * Returns true if the file was (re)written.
 */
export function ensureCopilotHooksConfig(port: number): boolean {
  try {
    const desired = JSON.stringify(buildCopilotHooksConfig(port), null, 2) + '\n';
    if (existsSync(CONFIG_PATH)) {
      try {
        if (readFileSync(CONFIG_PATH, 'utf-8') === desired) return false;
      } catch { /* fall through and rewrite */ }
    }
    mkdirSync(COPILOT_HOOKS_DIR, { recursive: true });
    writeFileSync(CONFIG_PATH, desired);
    console.log(`[copilot-hooks] wrote ${CONFIG_PATH}`);
    return true;
  } catch (err) {
    console.error('[copilot-hooks] failed to write config:', err);
    return false;
  }
}
