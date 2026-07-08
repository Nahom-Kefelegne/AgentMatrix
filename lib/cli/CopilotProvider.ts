import { execSync } from 'child_process';
import { existsSync, readdirSync, statSync, openSync, readSync, closeSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type {
  CliProvider,
  CliHealth,
  SpawnOptions,
  ResumeOptions,
  CliType,
  DiscoveredSession,
  ActiveProcessInfo,
  PermissionMode,
} from './CliProvider';
import { COPILOT_MODELS, COPILOT_PERMISSION_MODES } from './uiMetadata';

/**
 * Strip ANSI escape codes from terminal output.
 */
function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\x1b\[\?[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1b[()][AB012]/g, '')
    .replace(/\x1b\[<[a-zA-Z]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '');
}

/** Official GitHub Copilot icon (from primer/octicons, MIT licensed) */
const COPILOT_ICON_SVG = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M7.998 15.035c-4.562 0-7.873-2.914-7.998-3.749V9.338c.085-.628.677-1.686 1.588-2.065.013-.07.024-.143.036-.218.029-.183.06-.384.126-.612-.201-.508-.254-1.084-.254-1.656 0-.87.128-1.769.693-2.484.579-.733 1.494-1.124 2.724-1.261 1.206-.134 2.262.034 2.944.765.05.053.096.108.139.165.044-.057.094-.112.143-.165.682-.731 1.738-.899 2.944-.765 1.23.137 2.145.528 2.724 1.261.566.715.693 1.614.693 2.484 0 .572-.053 1.148-.254 1.656.066.228.098.429.126.612.012.076.024.148.037.218.924.385 1.522 1.471 1.591 2.095v1.872c0 .766-3.351 3.795-8.002 3.795Zm0-1.485c2.28 0 4.584-1.11 5.002-1.433V7.862l-.023-.116c-.49.21-1.075.291-1.727.291-1.146 0-2.059-.327-2.71-.991A3.222 3.222 0 0 1 8 6.303a3.24 3.24 0 0 1-.544.743c-.65.664-1.563.991-2.71.991-.652 0-1.236-.081-1.727-.291l-.023.116v4.255c.419.323 2.722 1.433 5.002 1.433ZM6.762 2.83c-.193-.206-.637-.413-1.682-.297-1.019.113-1.479.404-1.713.7-.247.312-.369.789-.369 1.554 0 .793.129 1.171.308 1.371.162.181.519.379 1.442.379.853 0 1.339-.235 1.638-.54.315-.322.527-.827.617-1.553.117-.935-.037-1.395-.241-1.614Zm4.155-.297c-1.044-.116-1.488.091-1.681.297-.204.219-.359.679-.242 1.614.091.726.303 1.231.618 1.553.299.305.784.54 1.638.54.922 0 1.28-.198 1.442-.379.179-.2.308-.578.308-1.371 0-.765-.123-1.242-.37-1.554-.233-.296-.693-.587-1.713-.7Z"/>
  <path d="M6.25 9.037a.75.75 0 0 1 .75.75v1.501a.75.75 0 0 1-1.5 0V9.787a.75.75 0 0 1 .75-.75Zm4.25.75v1.501a.75.75 0 0 1-1.5 0V9.787a.75.75 0 0 1 1.5 0Z"/>
</svg>`;

const COPILOT_CONFIG_DIR = join(homedir(), '.copilot');
const COPILOT_SESSION_STATE_DIR = join(COPILOT_CONFIG_DIR, 'session-state');

const TRUST_PROMPT_PATTERNS = [
  'Do you trust the files',
  'Confirm folder trust',
];

const CONTEXT_PROMPT_PATTERNS: string[] = [];

/** UUID v4 pattern, used to filter session-state dirs. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read the first ~4KB of a file. Used to extract small workspace.yaml
 * files efficiently without loading the whole thing.
 */
function readFirstBytes(path: string, bytes = 4000): string {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const n = readSync(fd, buf, 0, bytes, 0);
    return buf.toString('utf-8', 0, n);
  } finally {
    closeSync(fd);
  }
}

/**
 * Minimal flat-YAML parser tailored to Copilot's workspace.yaml. Reads
 * `key: value` pairs at the top level; ignores comments, lists, nested
 * keys. Strips surrounding quotes from values. Also handles block scalars
 * (`key: |` / `|-` / `>` / `>-`) by joining the following indented lines —
 * Copilot writes multi-line auto-generated session names this way.
 *
 * NOT a general YAML parser — we don't want to pull in `js-yaml` for
 * a 7-line file format.
 */
function parseFlatYaml(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    if (!line || line.startsWith('#') || line.startsWith(' ')) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();

    // Block scalar (| , |- , > , >-): the value is on the following
    // indented lines. Collect them until dedent, then fold to one line.
    if (/^[|>][-+]?$/.test(value)) {
      const collected: string[] = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const next = lines[j];
        if (next.trim() === '') { collected.push(''); continue; }
        if (!/^\s/.test(next)) break; // dedent → end of block
        collected.push(next.replace(/^\s+/, ''));
      }
      i = j - 1;
      value = collected.join(' ').replace(/\s+/g, ' ').trim();
      out[key] = value;
      continue;
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Whether a Copilot session has real conversation activity. Empty/aborted
 * sessions leave behind a dir with only a `workspace.yaml` and either no
 * `events.jsonl` or one containing just a `session.start` event. We treat a
 * session as having activity if events.jsonl exists and contains at least one
 * user/assistant message. Reads only the first chunk (messages appear early).
 */
function copilotSessionHasActivity(sessionDir: string): boolean {
  const eventsFile = join(sessionDir, 'events.jsonl');
  if (!existsSync(eventsFile)) return false;
  try {
    const head = readFirstBytes(eventsFile, 16000);
    return /"type"\s*:\s*"(user\.message|assistant\.message)"/.test(head);
  } catch {
    return false;
  }
}

export class CopilotProvider implements CliProvider {
  readonly type: CliType = 'copilot';
  readonly configDir = COPILOT_CONFIG_DIR;
  readonly displayName = 'GitHub Copilot';
  readonly iconSvg = COPILOT_ICON_SVG;
  readonly iconColor = '#6E40C9';

  readonly supportsMcp = false;          // No MCP system-prompt injection until verified.
  readonly supportsFork = false;         // No --fork-session equivalent.
  readonly supportsContextTracking = false; // parseContextUsage returns null today.
  readonly supportsSubagents = true;     // /fleet + subagent hooks supported.
  readonly supportsAcp = true;           // `copilot --acp --stdio` available.

  findBinary(): string {
    try {
      const cmd = process.platform === 'win32' ? 'where copilot' : 'which copilot';
      const result = execSync(cmd, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim().split(/\r?\n/)[0].trim();
      if (result) return result;
    } catch { /* ignore */ }

    const home = homedir();
    const candidates = process.platform === 'win32'
      ? [
          join(home, 'AppData', 'Roaming', 'npm', 'copilot.cmd'),
          join(home, 'AppData', 'Roaming', 'npm', 'copilot'),
          join(home, 'AppData', 'Local', 'Programs', 'copilot', 'copilot.exe'),
          'C:\\Program Files\\GitHub Copilot CLI\\copilot.exe',
        ]
      : [
          '/usr/local/bin/copilot',
          join(home, '.local', 'bin', 'copilot'),
          join(home, '.npm-global', 'bin', 'copilot'),
          '/opt/homebrew/bin/copilot',
        ];

    for (const p of candidates) {
      if (existsSync(p)) return p;
    }

    // Agency-managed install: ~/.copilot-cli/<version>/copilot
    const agencyDir = join(home, '.copilot-cli');
    if (existsSync(agencyDir)) {
      try {
        const versions = readdirSync(agencyDir)
          .filter(d => existsSync(join(agencyDir, d, 'copilot')))
          .sort()
          .reverse();
        if (versions.length > 0) {
          return join(agencyDir, versions[0], 'copilot');
        }
      } catch { /* ignore */ }
    }

    throw new Error('Copilot CLI not found. Install it or add it to PATH.');
  }

  checkHealth(): CliHealth {
    try {
      const binaryPath = this.findBinary();
      const version = execSync(`"${binaryPath}" --version`, {
        encoding: 'utf-8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      return { type: 'copilot', installed: true, version, binaryPath };
    } catch {
      let binaryPath: string | null = null;
      try { binaryPath = this.findBinary(); } catch { /* not found */ }

      return {
        type: 'copilot',
        installed: false,
        version: null,
        binaryPath,
        error: binaryPath
          ? `Binary found at ${binaryPath} but version check failed`
          : 'Copilot CLI not found. Install it or add it to PATH.',
      };
    }
  }

  buildSpawnArgs(opts: SpawnOptions): string[] {
    const args: string[] = [];
    // Pin the session UUID so the app's tracking id equals Copilot's real
    // on-disk session id (~/.copilot/session-state/<id>/). Copilot's help:
    // "--session-id <id>: ... or set the UUID for a new session". Verified
    // (CLI 1.0.67+): a new session is created at exactly this UUID, so
    // --resume <id>, findSessionCwd, and workspace.yaml lookups all resolve.
    if (opts.sessionId) args.push('--session-id', opts.sessionId);
    // Persist a durable, user-named session name. Verified: -n writes
    // `name:`/`user_named: true` into workspace.yaml and survives resume, so
    // names don't rely on the app-side nameCache workaround (as Claude does).
    if (opts.name) args.push('-n', opts.name);
    // YOLO / bypass-permissions in current Copilot CLI is --allow-all
    // (equivalent to --allow-all-tools --allow-all-paths --allow-all-urls).
    // Older versions used --yolo; that flag was renamed/removed in 1.0.3x.
    if (opts.permissionMode === 'bypassPermissions') {
      args.push('--allow-all');
    }
    // --mode accepts "interactive" | "plan" | "autopilot". Skip the flag
    // when interactive since that's the default.
    if (opts.copilotMode && opts.copilotMode !== 'interactive') {
      args.push('--mode', opts.copilotMode);
    }
    if (opts.model) args.push('--model', opts.model);
    if (opts.effort) args.push('--reasoning-effort', opts.effort);
    if (opts.allowedTools) {
      for (const tool of opts.allowedTools.split(',').map(t => t.trim()).filter(Boolean)) {
        args.push(`--allow-tool=${tool}`);
      }
    }
    return args;
  }

  buildResumeArgs(opts: ResumeOptions): string[] {
    // Copilot remembers permission state on resume; no --yolo or --fork.
    return ['--resume', opts.resumeId];
  }

  buildResumeShellCommand(opts: ResumeOptions): string {
    return `copilot ${this.buildResumeArgs(opts).join(' ')}`;
  }

  getExitSequence(): Array<{ data: string; delayMs: number }> {
    // Copilot's TUI ignores `/exit`. Verified (CLI 1.0.67+): two Ctrl-C
    // keystrokes (0x03) with a short gap trigger graceful shutdown — the
    // session's inuse.<PID>.lock is removed and the process exits. A single
    // Ctrl-C only interrupts the current turn.
    return [
      { data: '\x03', delayMs: 400 },
      { data: '\x03', delayMs: 0 },
    ];
  }

  detectPromptReady(text: string): boolean {
    const clean = stripAnsi(text).trim();
    return /[$❯›>]\s*$/.test(clean);
  }

  parseContextUsage(_text: string): number | null {
    // Copilot's TUI context-usage format hasn't been characterized yet.
    // Returning null disables the context bar for Copilot until then.
    // Tracked in design doc Phase 0 task 0.9.
    return null;
  }

  getTrustPromptPatterns(): string[] { return TRUST_PROMPT_PATTERNS; }
  getContextPromptPatterns(): string[] { return CONTEXT_PROMPT_PATTERNS; }
  getModelList() { return COPILOT_MODELS; }
  getPermissionModes(): PermissionMode[] { return COPILOT_PERMISSION_MODES; }

  /**
   * COST: O(N) directory scans + one tiny YAML read per session
   * (~few hundred bytes each). Call from UI flows only.
   */
  discoverSessions(): DiscoveredSession[] {
    if (!existsSync(COPILOT_SESSION_STATE_DIR)) return [];
    const results: DiscoveredSession[] = [];

    let entries: string[];
    try {
      entries = readdirSync(COPILOT_SESSION_STATE_DIR);
    } catch {
      return [];
    }

    for (const entry of entries) {
      if (!UUID_RE.test(entry)) continue;
      const sessionDir = join(COPILOT_SESSION_STATE_DIR, entry);
      const workspaceFile = join(sessionDir, 'workspace.yaml');

      let cwd: string | undefined;
      let name: string | undefined;
      let lastModified: number | undefined;

      try {
        const st = statSync(sessionDir);
        if (!st.isDirectory()) continue;
        lastModified = st.mtimeMs;
      } catch {
        continue;
      }

      try {
        if (existsSync(workspaceFile)) {
          const meta = parseFlatYaml(readFirstBytes(workspaceFile, 2000));
          if (meta.cwd) cwd = meta.cwd;
          // Copilot auto-names (block scalars) can be a whole sentence; cap
          // to a tidy label for the session list.
          if (meta.name) {
            name = meta.name.length > 60 ? `${meta.name.slice(0, 57)}...` : meta.name;
          }
        }
      } catch { /* ignore — return partial data */ }

      // Hide empty/aborted sessions (no name AND no conversation) — they're
      // just leftover dirs with nothing to resume and clutter the list. A
      // named session is always kept (the name is meaningful even if short).
      if (!name && !copilotSessionHasActivity(sessionDir)) continue;

      results.push({ id: entry, cwd, name, lastModified });
    }

    return results;
  }

  /**
   * COST: O(1) — directly opens `<sessionId>/workspace.yaml`.
   */
  findSessionCwd(sessionId: string): string | undefined {
    if (!UUID_RE.test(sessionId)) return undefined;
    const workspaceFile = join(COPILOT_SESSION_STATE_DIR, sessionId, 'workspace.yaml');
    if (!existsSync(workspaceFile)) return undefined;
    try {
      const meta = parseFlatYaml(readFirstBytes(workspaceFile, 2000));
      return meta.cwd || undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Rename a Copilot session by writing `name`/`user_named: true` into its
   * workspace.yaml. Verified (CLI 1.0.67+): Copilot respects this on disk and
   * preserves it across resume without clobbering — even while the session is
   * running — so no PTY interaction is needed. Only the top-level `name:` and
   * `user_named:` lines are touched; every other line is preserved verbatim so
   * we don't disturb Copilot's own fields.
   */
  renameSession(sessionId: string, newName: string): boolean {
    if (!UUID_RE.test(sessionId)) return false;
    const workspaceFile = join(COPILOT_SESSION_STATE_DIR, sessionId, 'workspace.yaml');
    if (!existsSync(workspaceFile)) return false;
    const name = newName.trim();
    if (!name) return false;
    // Quote to keep the value on one line regardless of its characters and to
    // overwrite any prior block-scalar (`name: |-`) form.
    const nameLine = `name: ${JSON.stringify(name)}`;
    try {
      const original = readFileSync(workspaceFile, 'utf-8');
      const lines = original.split('\n');
      const out: string[] = [];
      let sawName = false;
      let sawUserNamed = false;
      let skipBlock = false;
      for (const line of lines) {
        // Drop the continuation lines of a previous block-scalar name value.
        if (skipBlock) {
          if (line.trim() === '' || /^\s/.test(line)) continue;
          skipBlock = false;
        }
        if (/^name:/.test(line)) {
          out.push(nameLine);
          sawName = true;
          if (/^name:\s*[|>][-+]?\s*$/.test(line)) skipBlock = true;
          continue;
        }
        if (/^user_named:/.test(line)) {
          out.push('user_named: true');
          sawUserNamed = true;
          continue;
        }
        out.push(line);
      }
      if (!sawName) out.splice(1, 0, nameLine);
      if (!sawUserNamed) {
        // Keep a trailing newline tidy.
        if (out.length && out[out.length - 1] === '') out.splice(out.length - 1, 0, 'user_named: true');
        else out.push('user_named: true');
      }
      writeFileSync(workspaceFile, out.join('\n'));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * COST: spawns one `ps`/`wmic` subprocess. Cross-checks against the
   * on-disk `inuse.*.lock` files so we can map PID → sessionId reliably.
   */
  detectActiveSessionIds(): ActiveProcessInfo[] {
    // New sessions are now spawned with `--session-id <UUID>` (so the app id
    // equals Copilot's on-disk id), but we still detect active sessions via
    // the on-disk `~/.copilot/session-state/<UUID>/inuse.<PID>.lock` files
    // rather than parsing process args: the lock reliably maps a live PID to
    // its session UUID even for sessions started outside the app (or resumed,
    // where the UUID isn't on the command line). We enumerate locks and verify
    // the PID is alive.
    if (!existsSync(COPILOT_SESSION_STATE_DIR)) return [];

    const livePids = collectLiveCopilotPids();
    if (livePids.size === 0) return [];

    const result: ActiveProcessInfo[] = [];
    let dirs: string[];
    try {
      dirs = readdirSync(COPILOT_SESSION_STATE_DIR);
    } catch {
      return [];
    }

    for (const dir of dirs) {
      if (!UUID_RE.test(dir)) continue;
      let sessionEntries: string[];
      try {
        sessionEntries = readdirSync(join(COPILOT_SESSION_STATE_DIR, dir));
      } catch {
        continue;
      }
      for (const file of sessionEntries) {
        const m = file.match(/^inuse\.(\d+)\.lock$/);
        if (!m) continue;
        const pid = parseInt(m[1], 10);
        if (livePids.has(pid)) {
          result.push({ sessionId: dir });
          break;
        }
      }
    }
    return result;
  }
}

/** Returns the set of PIDs whose command line includes "copilot". */
function collectLiveCopilotPids(): Set<number> {
  const pids = new Set<number>();
  if (process.platform === 'win32') {
    try {
      const output = execSync(
        'wmic process where "name=\'copilot.exe\' or name=\'node.exe\'" get ProcessId,CommandLine /format:csv',
        { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] },
      );
      for (const line of output.split('\n')) {
        if (!/copilot/i.test(line)) continue;
        // CSV format: Node,CommandLine,ProcessId
        const cols = line.split(',');
        const pidStr = cols[cols.length - 1]?.trim();
        const pid = parseInt(pidStr, 10);
        if (Number.isFinite(pid)) pids.add(pid);
      }
    } catch { /* ignore */ }
    return pids;
  }

  try {
    const output = execSync(
      "ps -eo pid,args | grep '[c]opilot' | grep -v grep",
      { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    for (const line of output.split('\n')) {
      const m = line.trim().match(/^(\d+)\s/);
      if (m) pids.add(parseInt(m[1], 10));
    }
  } catch { /* ignore */ }
  return pids;
}
