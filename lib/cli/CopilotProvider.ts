import { execSync, execFile, execFileSync } from 'child_process';
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
import { pickSpawnableBinary } from './binaryPath';

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
/** Global SQLite store with per-turn token accounting. */
const COPILOT_SESSION_STORE_DB = join(COPILOT_CONFIG_DIR, 'session-store.db');

/**
 * Context-window size (tokens) per model, used to turn a raw input-token count
 * into a "% used" gauge. Copilot's long_context tier advertises "1M context"
 * for the models it runs, so 1,000,000 is a sane default; override per model as
 * needed. This is an approximate gauge, like Claude's text-parsed value.
 */
const DEFAULT_CONTEXT_WINDOW = 1_000_000;
function contextWindowForModel(_model: string): number {
  return DEFAULT_CONTEXT_WINDOW;
}

function execText(command: string, args: string[], timeout = 2500): Promise<string | null> {
  return new Promise(resolve => {
    execFile(
      command,
      args,
      { timeout, windowsHide: true, encoding: 'utf8' },
      (error, stdout) => resolve(error ? null : stdout.trim()),
    );
  });
}

async function readLatestUsageRow(sessionId: string): Promise<string | null> {
  const sql =
    `SELECT input_tokens, model FROM assistant_usage_events ` +
    `WHERE session_id='${sessionId}' ORDER BY id DESC LIMIT 1;`;

  const sqliteRow = await execText(
    'sqlite3',
    ['-readonly', '-separator', '|', COPILOT_SESSION_STORE_DB, sql],
  );
  if (sqliteRow) return sqliteRow;

  // Windows installations commonly have modern Node (npm 11 ships with Node
  // 22/24) but no sqlite3.exe. Use Node's built-in SQLite in a child process so
  // the synchronous query never blocks Electron's main thread.
  const nodeScript = [
    `const { DatabaseSync } = require('node:sqlite');`,
    `const db = new DatabaseSync(process.argv[1], { readOnly: true });`,
    `try {`,
    `  const row = db.prepare('SELECT input_tokens, model FROM assistant_usage_events WHERE session_id=? ORDER BY id DESC LIMIT 1').get(process.argv[2]);`,
    `  if (row) process.stdout.write(String(row.input_tokens) + '|' + String(row.model || ''));`,
    `} finally { db.close(); }`,
  ].join('');
  const nodeRow = await execText(
    'node',
    ['--no-warnings', '--experimental-sqlite', '-e', nodeScript, COPILOT_SESSION_STORE_DB, sessionId],
  );
  if (nodeRow) return nodeRow;

  // Python's standard library is a final dependency-free fallback for machines
  // with an older Node runtime.
  const pythonScript = [
    `import sqlite3,sys\n`,
    `db=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro', uri=True, timeout=1)\n`,
    `try:\n`,
    ` row=db.execute('SELECT input_tokens, model FROM assistant_usage_events WHERE session_id=? ORDER BY id DESC LIMIT 1',(sys.argv[2],)).fetchone()\n`,
    ` if row: print(str(row[0])+'|'+str(row[1] or ''),end='')\n`,
    `finally:\n db.close()\n`,
  ].join('');
  const pythonCandidates: Array<[string, string[]]> = process.platform === 'win32'
    ? [
        ['py', ['-3', '-c', pythonScript, COPILOT_SESSION_STORE_DB, sessionId]],
        ['python', ['-c', pythonScript, COPILOT_SESSION_STORE_DB, sessionId]],
        ['python3', ['-c', pythonScript, COPILOT_SESSION_STORE_DB, sessionId]],
      ]
    : [
        ['python3', ['-c', pythonScript, COPILOT_SESSION_STORE_DB, sessionId]],
        ['python', ['-c', pythonScript, COPILOT_SESSION_STORE_DB, sessionId]],
      ];
  for (const [command, args] of pythonCandidates) {
    const row = await execText(command, args);
    if (row) return row;
  }
  return null;
}

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

  // Copilot receives AgentMatrix context through MCP server initialization
  // instructions, not Claude's --append-system-prompt mechanism.
  readonly supportsMcp = false;
  readonly supportsFork = false;         // No --fork-session equivalent.
  readonly supportsContextTracking = true;  // getContextUsage reads session-store.db.
  readonly supportsSubagents = true;     // /fleet + subagent hooks supported.
  readonly supportsAcp = true;           // `copilot --acp --stdio` available.

  findBinary(): string {
    try {
      const cmd = process.platform === 'win32' ? 'where copilot' : 'which copilot';
      const output = execSync(cmd, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const result = pickSpawnableBinary(output.trim().split(/\r?\n/));
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
    // Enable mouse support in alt-screen mode so the timeline scrolls
    // line-by-line under the wheel (Copilot enables SGR mouse tracking, modes
    // 1003+1006, which xterm forwards as native wheel events). This is on by
    // default under Windows/ConPTY but OFF on macOS/Linux, which is why the
    // console previously only paged. CopilotTerminalPanel detects the mouse
    // DECSET and defers the wheel to xterm's native forwarding.
    args.push('--mouse');
    if (opts.allowedTools) {
      for (const tool of opts.allowedTools.split(',').map(t => t.trim()).filter(Boolean)) {
        args.push(`--allow-tool=${tool}`);
      }
    }
    return args;
  }

  buildResumeArgs(opts: ResumeOptions): string[] {
    const args = ['--resume', opts.resumeId, '--mouse'];
    if (opts.permissionMode === 'bypassPermissions') args.push('--allow-all');
    if (opts.copilotMode && opts.copilotMode !== 'interactive') {
      args.push('--mode', opts.copilotMode);
    }
    if (opts.model) args.push('--model', opts.model);
    if (opts.effort) args.push('--reasoning-effort', opts.effort);
    if (opts.allowedTools) {
      for (const tool of opts.allowedTools.split(',').map(value => value.trim()).filter(Boolean)) {
        args.push(`--allow-tool=${tool}`);
      }
    }
    return args;
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
    // Copilot doesn't print context usage in its TUI text stream — usage is
    // tracked on disk instead. See getContextUsage().
    return null;
  }

  /**
   * Context-window usage (% used, 0-100) read from Copilot's own token
   * accounting in `~/.copilot/session-store.db`. The latest turn's
   * `input_tokens` is the running context total (the full context sent to the
   * model), so `input_tokens / windowForModel` is the fill level.
   *
   * Reads asynchronously through the first available system runtime: sqlite3,
   * modern Node's built-in SQLite, or Python's standard sqlite3 module. All run
   * in child processes, so live WAL reads never block Electron's main thread.
   * Returns null when no compatible runtime or usage row is available.
   */
  async getContextUsage(sessionId: string): Promise<number | null> {
    if (!UUID_RE.test(sessionId)) return null;
    if (!existsSync(COPILOT_SESSION_STORE_DB)) return null;

    const row = await readLatestUsageRow(sessionId);
    if (!row) return null;

    const [inputStr, model] = row.split('|');
    const inputTokens = parseInt(inputStr, 10);
    if (!Number.isFinite(inputTokens) || inputTokens <= 0) return null;

    const pct = Math.round((inputTokens / contextWindowForModel(model || '')) * 100);
    // Clamp to 0-99 so the gauge never claims a full/over-full window from a
    // rough estimate.
    return Math.max(0, Math.min(99, pct));
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
    // Cache the scan result briefly: discoverSessions walks every session dir
    // (statSync + workspace.yaml read + activity check) which is slow on network
    // drives, and it's hit by both the resume modal and the periodic scanner.
    // A short TTL keeps repeated opens instant and bounds how often the sync
    // disk walk can block the event loop.
    const now = Date.now();
    if (discoverCache && now - discoverCache.ts < DISCOVER_TTL_MS) {
      return discoverCache.sessions;
    }
    const sessions = this.discoverSessionsUncached();
    discoverCache = { sessions, ts: now };
    return sessions;
  }

  private discoverSessionsUncached(): DiscoveredSession[] {
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

  /** Copilot stores each session's event log at session-state/<id>/events.jsonl. */
  getTranscriptPath(sessionId: string): string | undefined {
    if (!UUID_RE.test(sessionId)) return undefined;
    const eventsFile = join(COPILOT_SESSION_STATE_DIR, sessionId, 'events.jsonl');
    return existsSync(eventsFile) ? eventsFile : undefined;
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
// Detecting live PIDs runs a slow subprocess (`wmic` on Windows can take several
// seconds, `ps` on Unix), and it's called by detectActiveSessionIds() on every
// resume-modal open and every background scan. Blocking the shared event loop on
// it froze the whole app. Cache the result and refresh it ASYNCHRONOUSLY: after
// the first (startup) warm-up, callers get the cached set instantly and a stale
// cache triggers a background refresh — so a modal open never blocks on wmic.
const LIVE_PIDS_TTL_MS = 4000;
let livePidsCache: { pids: Set<number>; ts: number } | null = null;
let livePidsRefreshing = false;

// Short-TTL cache for the session-dir scan (see discoverSessions).
const DISCOVER_TTL_MS = 4000;
let discoverCache: { sessions: DiscoveredSession[]; ts: number } | null = null;

function livePidsCommand(): { cmd: string; args: string[]; shell: boolean } {
  if (process.platform === 'win32') {
    return {
      cmd: 'wmic',
      args: ['process', 'where', "name='copilot.exe' or name='node.exe'", 'get', 'ProcessId,CommandLine', '/format:csv'],
      shell: false,
    };
  }
  return { cmd: '/bin/sh', args: ['-c', "ps -eo pid,args | grep '[c]opilot' | grep -v grep"], shell: false };
}

function parseLivePids(output: string): Set<number> {
  const pids = new Set<number>();
  if (process.platform === 'win32') {
    for (const line of output.split('\n')) {
      if (!/copilot/i.test(line)) continue;
      const cols = line.split(',');
      const pid = parseInt(cols[cols.length - 1]?.trim(), 10);
      if (Number.isFinite(pid)) pids.add(pid);
    }
  } else {
    for (const line of output.split('\n')) {
      const m = line.trim().match(/^(\d+)\s/);
      if (m) pids.add(parseInt(m[1], 10));
    }
  }
  return pids;
}

function refreshLivePidsAsync(): void {
  if (livePidsRefreshing) return;
  livePidsRefreshing = true;
  const { cmd, args } = livePidsCommand();
  execFile(cmd, args, { encoding: 'utf-8', timeout: 5000, windowsHide: true }, (err, stdout) => {
    livePidsRefreshing = false;
    if (err) return; // keep the previous cache on failure
    livePidsCache = { pids: parseLivePids(stdout || ''), ts: Date.now() };
  });
}

function collectLiveCopilotPids(): Set<number> {
  const now = Date.now();
  if (livePidsCache) {
    // Serve cached instantly; kick off a background refresh if stale.
    if (now - livePidsCache.ts >= LIVE_PIDS_TTL_MS) refreshLivePidsAsync();
    return livePidsCache.pids;
  }
  // Cold start (typically the very first background scan at startup): do one
  // synchronous read to seed the cache, then all later calls stay non-blocking.
  const { cmd, args } = livePidsCommand();
  try {
    const output = execFileSync(cmd, args, { encoding: 'utf-8', timeout: 5000, windowsHide: true });
    livePidsCache = { pids: parseLivePids(output), ts: now };
  } catch {
    livePidsCache = { pids: new Set(), ts: now };
  }
  return livePidsCache.pids;
}
