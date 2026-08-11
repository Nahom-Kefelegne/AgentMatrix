import { execSync, execFile, execFileSync } from 'child_process';
import { existsSync, readdirSync, statSync, openSync, readSync, closeSync, readFileSync } from 'fs';
import { isAbsolute, join } from 'path';
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
import { pickSpawnableBinary } from './binaryPath';
import { KIMI_MODELS, KIMI_PERMISSION_MODES } from './uiMetadata';

/**
 * Provider for Kimi Code CLI (Moonshot AI) — npm `@moonshot-ai/kimi-code`,
 * binary `kimi`, repo https://github.com/MoonshotAI/kimi-code.
 *
 * SOURCES. Every flag, path and model alias below is taken from Moonshot's own
 * documentation, cross-checked against two independent renderings of it:
 *   - Command reference: docs/en/reference/kimi-command.md, also published at
 *     https://moonshotai.github.io/kimi-code/en/reference/kimi-command.html and
 *     https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-command.html
 *   - Data locations: docs/en/configuration/data-locations.md, also at
 *     .../en/configuration/data-locations.html
 *   - Slash commands: docs/en/reference/slash-commands.md
 *   - Models/providers: docs/en/configuration/providers.md + config-files.html
 *
 * ANYTHING NOT IN THOSE DOCS IS MARKED "UNVERIFIED" AND DEGRADES TO
 * null/empty/false rather than guessing. Kimi Code CLI was not installed on the
 * machine this provider was written on, so nothing here is confirmed against a
 * live binary the way ClaudeProvider/CopilotProvider were. The UNVERIFIED
 * comments are the checklist for whoever gets to run `kimi` for real.
 */

/**
 * Generic crescent mark, authored for this file — NOT Moonshot's official Kimi
 * brand logo. ClaudeProvider/CopilotProvider embed real, licensed brand SVGs
 * (claude.ai favicon, primer/octicons); no equivalently verifiable Kimi asset
 * was found, and inventing brand art is worse than shipping a neutral glyph.
 * Swap in the official mark when one is available under a known license.
 */
const KIMI_ICON_SVG = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M9.6 1.2a6.8 6.8 0 1 0 5.2 10.9 5.6 5.6 0 1 1-5.2-8.9 6.9 6.9 0 0 1 0-2Z"/>
  <path d="M12.4 1.1l.62 1.67 1.68.62-1.68.62-.62 1.68-.62-1.68L10.1 3.4l1.68-.62.62-1.67Z"/>
</svg>`;

/**
 * Data root. Verified: defaults to `~/.kimi-code` on all three platforms
 * (macOS `/Users/<name>/.kimi-code`, Linux `/home/<name>/.kimi-code`, Windows
 * `C:\Users\<name>\.kimi-code`) and is overridden by `KIMI_CODE_HOME`.
 */
const KIMI_HOME = process.env.KIMI_CODE_HOME || join(homedir(), '.kimi-code');

/**
 * Verified layout under the data root:
 *   session_index.jsonl          one JSON record per line, fields
 *                                `sessionId`, `sessionDir`, `workDir`
 *   sessions/<workDirKey>/<sessionId>/state.json
 *                                metadata: `title`, `lastPrompt`,
 *                                creation/update timestamps, `forkedFrom`
 *   sessions/<workDirKey>/<sessionId>/agents/main/wire.jsonl
 *                                the main agent's complete communication
 *                                record, used for resumption and replay
 *
 * `workDirKey` is documented as `wd_<slug>_<first-12-chars-of-sha256>`, but we
 * never derive it: session_index.jsonl already maps sessionId → sessionDir, so
 * the exact hashing scheme stays an implementation detail of the CLI.
 */
const KIMI_SESSION_INDEX = join(KIMI_HOME, 'session_index.jsonl');
const KIMI_SESSIONS_DIR = join(KIMI_HOME, 'sessions');

/**
 * Model aliases shipped in Moonshot's documented default config, with
 * `provider = "managed:kimi-code"`. `kimi-code/k3` is the `default_model` in
 * the reference config. `kimi-for-coding` is documented with
 * max_context_size 262144.
 *
 * Kimi's model list is genuinely user-extensible — `[models."<alias>"]` entries
 * in `~/.kimi-code/config.toml`, plus `/provider` imports from models.dev — so
 * this is the built-in set, not an exhaustive one. `''` means "use
 * `default_model` from the config file" (verified: `--model` "when omitted, new
 * sessions use `default_model` from the config file").
 *
 * The table itself now lives in `uiMetadata.ts` alongside CLAUDE_MODELS /
 * COPILOT_MODELS and is imported above: that module is browser-safe, whereas
 * this file pulls in `child_process`/`fs` at the top level and so cannot be
 * reached from client bundles.
 */

/**
 * Verified permission surface. Kimi exposes exactly two approval-bypass flags
 * plus a plan mode:
 *   --yolo / -y   "Auto-approve regular tool calls, skipping approval requests"
 *   --auto        "Start with auto permission mode; tool approvals are handled
 *                  automatically"
 *   --plan        "Start a new session in Plan mode"
 * `--yolo` and `--auto` are documented as mutually exclusive.
 *
 * There is NO `acceptEdits` equivalent — Claude's mode of that name has no Kimi
 * counterpart, so it is deliberately absent rather than mapped to something
 * approximate.
 */

/**
 * Permissive session-id guard, used before interpolating an id into a path.
 * Kimi's docs only ever show ids as `01HZ...XYZ` (which looks like a ULID) and
 * never state the format, so this deliberately does NOT assert ULID — it just
 * rejects anything that could escape a directory or smuggle separators.
 * UNVERIFIED: the real id alphabet and length.
 */
const KIMI_SESSION_ID_RE = /^[A-Za-z0-9_][A-Za-z0-9_-]{5,63}$/;

/** Strip ANSI escape codes from terminal output. Mirrors the other providers. */
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

/** Read the first N bytes of a file, for cheap header reads on large files. */
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

/** One line of session_index.jsonl. Fields per Moonshot's data-locations doc. */
export interface KimiSessionIndexEntry {
  sessionId: string;
  /** Absolute session directory. See resolveSessionDir for the relative case. */
  sessionDir: string;
  /** The working directory the session was started in. */
  workDir: string;
}

/**
 * Parse session_index.jsonl. Tolerates blank lines, truncated trailing writes,
 * and records missing fields — the CLI appends to this file live, so a partial
 * last line is normal rather than exceptional.
 *
 * Pure (string in, records out) so it is unit-testable without a Kimi install.
 */
export function parseKimiSessionIndex(text: string): KimiSessionIndexEntry[] {
  const out: KimiSessionIndexEntry[] = [];
  // Later records win: the index is append-only, so a re-indexed session
  // appears more than once and the last line is the current truth.
  const bySessionId = new Map<string, KimiSessionIndexEntry>();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue; // truncated / partially-flushed line
    }
    if (!parsed || typeof parsed !== 'object') continue;
    const record = parsed as Record<string, unknown>;
    const sessionId = typeof record.sessionId === 'string' ? record.sessionId : '';
    if (!sessionId) continue;
    bySessionId.set(sessionId, {
      sessionId,
      sessionDir: typeof record.sessionDir === 'string' ? record.sessionDir : '',
      workDir: typeof record.workDir === 'string' ? record.workDir : '',
    });
  }
  for (const entry of bySessionId.values()) out.push(entry);
  return out;
}

/**
 * Resolve an index record's `sessionDir` to an absolute path.
 *
 * UNVERIFIED: the docs name the field but do not say whether it is absolute or
 * relative to the data root. Both are handled rather than assuming one — a
 * relative value is resolved against KIMI_CODE_HOME.
 */
function resolveSessionDir(sessionDir: string): string | undefined {
  if (!sessionDir) return undefined;
  return isAbsolute(sessionDir) ? sessionDir : join(KIMI_HOME, sessionDir);
}

/** Read + parse session_index.jsonl, or [] when it is absent/unreadable. */
function readSessionIndex(): KimiSessionIndexEntry[] {
  if (!existsSync(KIMI_SESSION_INDEX)) return [];
  try {
    return parseKimiSessionIndex(readFileSync(KIMI_SESSION_INDEX, 'utf-8'));
  } catch {
    return [];
  }
}

/** The session title Kimi records in state.json (`/title` writes it). */
function readSessionTitle(sessionDir: string): string | undefined {
  const stateFile = join(sessionDir, 'state.json');
  if (!existsSync(stateFile)) return undefined;
  try {
    const parsed = JSON.parse(readFirstBytes(stateFile, 8000)) as Record<string, unknown>;
    const title = parsed.title;
    return typeof title === 'string' && title.trim() ? title.trim() : undefined;
  } catch {
    // A partial read of a >8KB state.json yields invalid JSON; the title is not
    // important enough to justify reading the whole file.
    return undefined;
  }
}

/** Verified path of the main agent's event log within a session directory. */
function wirePath(sessionDir: string): string {
  return join(sessionDir, 'agents', 'main', 'wire.jsonl');
}

// ─── Argument building (pure, unit-tested) ─────────────────────────

/**
 * Map an AgentMatrix permission mode onto Kimi's flags.
 *
 * `acceptEdits` and any unrecognised value intentionally produce no flag: Kimi
 * has no partial-approval mode, and emitting an approximate flag would silently
 * grant more (or less) than the caller asked for.
 *
 * `newSession` gates `--plan`, which is documented as "Start a NEW session in
 * Plan mode" — so it is not emitted when resuming.
 */
function permissionFlags(permissionMode: string | undefined, newSession: boolean): string[] {
  switch (permissionMode) {
    case 'bypassPermissions':
      return ['--yolo'];
    case 'auto':
      return ['--auto'];
    case 'plan':
      return newSession ? ['--plan'] : [];
    default:
      return [];
  }
}

/**
 * Build argv for a NEW interactive Kimi session.
 *
 * DELIBERATELY IGNORED, because Kimi documents no flag for them:
 *   - `opts.sessionId` — there is NO `--session-id` equivalent. `--session [id]`
 *     RESUMES an existing session; passing a fresh app-side id there would try
 *     (and fail) to resume a session that does not exist. Consequence: unlike
 *     Claude and Copilot, AgentMatrix's tracking id will NOT equal Kimi's
 *     on-disk session id for new sessions. Callers that rely on that identity
 *     (transcript lookup, active-process detection) must map through
 *     session_index.jsonl instead.
 *   - `opts.name` — no `-n` equivalent; titles are set in-TUI via `/title`.
 *   - `opts.effort` — no `--effort` / `--reasoning-effort` equivalent.
 *   - `opts.allowedTools` — no per-tool allow-list flag.
 *   - `opts.systemPrompt` — no `--append-system-prompt` equivalent.
 *
 * `opts.cwd` is applied by the spawner as the process working directory; Kimi
 * uses the process cwd as the workspace root, and `--add-dir` is for EXTRA
 * directories, so it is not used here.
 */
export function buildKimiSpawnArgs(opts: SpawnOptions): string[] {
  const args: string[] = [];
  args.push(...permissionFlags(opts.permissionMode, true));
  if (opts.model) args.push('--model', opts.model);
  // Documented: `--add-dir` adds EXTRA workspace directories beyond the process
  // cwd. Repeated per directory rather than variadic — UNVERIFIED against a live
  // binary (Kimi is not installed here), but repeating a flag is the form that
  // degrades safely if it turns out to accept multiple values.
  for (const dir of opts.addDirs ?? []) args.push('--add-dir', dir);
  return args;
}

/**
 * Build argv to resume a session. Verified: `--session <id>` "opens that
 * session directly". `--continue`/`-c` is the other resume path but targets
 * "the most recent session in the current working directory" rather than an id,
 * so it is not used.
 *
 * `opts.fork` is ignored: Kimi's fork is the in-TUI `/fork` slash command, with
 * no documented command-line flag (see `supportsFork = false`).
 */
export function buildKimiResumeArgs(opts: ResumeOptions): string[] {
  const args = ['--session', opts.resumeId];
  args.push(...permissionFlags(opts.permissionMode, false));
  if (opts.model) args.push('--model', opts.model);
  return args;
}

export class KimiProvider implements CliProvider {
  readonly type: CliType = 'kimi';
  readonly configDir = KIMI_HOME;
  readonly displayName = 'Kimi Code';
  /** Placeholder mark — see KIMI_ICON_SVG. */
  readonly iconSvg = KIMI_ICON_SVG;
  /** UNVERIFIED as a brand colour; chosen to read well in the session list. */
  readonly iconColor = '#5B5BD6';

  // ─── Capability flags ────────────────────────────────────────────
  /**
   * false. Kimi DOES support MCP servers (`mcp.json`, `/mcp-config`), but this
   * flag specifically means "accepts an MCP-aware system-prompt injection",
   * i.e. Claude's `--append-system-prompt`. Kimi documents no such flag, so
   * AgentMatrix cannot inject its context this way.
   */
  readonly supportsMcp = false;
  /** false. `/fork` exists only as an in-TUI slash command, not a CLI flag. */
  readonly supportsFork = false;
  /**
   * false. Kimi has no documented on-disk token accounting (state.json holds
   * title/lastPrompt/timestamps/forkedFrom only), and its TUI's usage rendering
   * is unverified. See parseContextUsage / getContextUsage.
   */
  readonly supportsContextTracking = false;
  /**
   * false. Kimi ships `coder`/`explore`/`plan` subagents, but this flag means
   * "emits SubagentStart/SubagentStop hooks AgentMatrix can observe", which is
   * unverified. Claiming it would make the fleet UI wait on events that may
   * never arrive.
   */
  readonly supportsSubagents = false;
  /**
   * true — the one capability verified outright: `kimi acp` enters "Agent
   * Client Protocol mode, communicating with an IDE via JSON-RPC over
   * stdin/stdout".
   */
  readonly supportsAcp = true;

  // ─── Binary + health ─────────────────────────────────────────────

  findBinary(): string {
    try {
      const cmd = process.platform === 'win32' ? 'where kimi' : 'which kimi';
      const output = execSync(cmd, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      // Windows lists the extensionless npm shim first; CreateProcess rejects
      // it with error 193, so always pick an executable extension.
      const result = pickSpawnableBinary(output.trim().split(/\r?\n/));
      if (result) return result;
    } catch { /* ignore */ }

    // Fallback locations. Kimi installs either via npm global
    // (`@moonshot-ai/kimi-code`, bin `kimi`) or via Moonshot's install script
    // (install.sh / install.ps1). UNVERIFIED: the exact directory the install
    // script targets, so only the npm paths and conventional user-bin
    // directories are probed. PATH lookup above is the real mechanism.
    const home = homedir();
    const candidates = process.platform === 'win32'
      ? [
          join(home, 'AppData', 'Roaming', 'npm', 'kimi.cmd'),
          join(home, 'AppData', 'Local', 'Programs', 'kimi', 'kimi.exe'),
        ]
      : [
          '/usr/local/bin/kimi',
          join(home, '.local', 'bin', 'kimi'),
          join(home, '.npm-global', 'bin', 'kimi'),
          '/opt/homebrew/bin/kimi',
        ];

    for (const p of candidates) {
      if (existsSync(p)) return p;
    }

    throw new Error('Kimi Code CLI not found. Install it or add it to PATH.');
  }

  checkHealth(): CliHealth {
    try {
      const binaryPath = this.findBinary();
      // Verified: `--version` / `-V` "Print the version number and exit".
      const version = execSync(`"${binaryPath}" --version`, {
        encoding: 'utf-8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      return { type: 'kimi', installed: true, version, binaryPath };
    } catch {
      let binaryPath: string | null = null;
      try { binaryPath = this.findBinary(); } catch { /* not found */ }

      return {
        type: 'kimi',
        installed: false,
        version: null,
        binaryPath,
        error: binaryPath
          ? `Binary found at ${binaryPath} but version check failed`
          : 'Kimi Code CLI not found. Install it or add it to PATH.',
      };
    }
  }

  // ─── Spawn / resume ──────────────────────────────────────────────

  buildSpawnArgs(opts: SpawnOptions): string[] { return buildKimiSpawnArgs(opts); }
  buildResumeArgs(opts: ResumeOptions): string[] { return buildKimiResumeArgs(opts); }

  buildResumeShellCommand(opts: ResumeOptions): string {
    return `kimi ${this.buildResumeArgs(opts).join(' ')}`;
  }

  getExitSequence(): Array<{ data: string; delayMs: number }> {
    // `/exit` (aliases `/quit`, `/q`) is documented as "Exit Kimi Code CLI".
    // UNVERIFIED against a live TUI: whether it flushes wire.jsonl and releases
    // state before exiting, the way Claude's `/exit` does. If a stale session is
    // ever left behind, this is the first thing to re-check.
    return [{ data: '/exit\r', delayMs: 0 }];
  }

  // ─── TUI parsing ─────────────────────────────────────────────────

  /**
   * UNVERIFIED: Kimi's actual prompt glyph was never observed. This reuses the
   * generic trailing-prompt heuristic that Claude and Copilot both use, which
   * is a guess about Kimi specifically. Returning `false` unconditionally would
   * be "safer" but would stall every caller that waits for readiness, so a
   * permissive heuristic is the better failure mode. Confirm against a live TUI.
   */
  detectPromptReady(text: string): boolean {
    const clean = stripAnsi(text).trim();
    return /[$❯›>]\s*$/.test(clean);
  }

  /**
   * null always. Kimi's TUI does render context usage (`/usage`, `/status`), but
   * its on-screen format is unverified, and a wrong regex silently reports a
   * wrong gauge rather than no gauge. Implement once the real output is known.
   */
  parseContextUsage(_text: string): number | null {
    return null;
  }

  /**
   * null always. Kimi's documented on-disk state (state.json: title,
   * lastPrompt, timestamps, forkedFrom) carries no token accounting, and
   * wire.jsonl's record schema is unverified. Copilot reads token counts from
   * session-store.db; Kimi has no documented equivalent.
   */
  async getContextUsage(_sessionId: string): Promise<number | null> {
    return null;
  }

  /**
   * Empty. Whether Kimi prompts for workspace trust on first launch — and with
   * what wording — is unverified. An empty list means the watcher simply does
   * not auto-accept; a wrong string would auto-send Enter at an unknown prompt,
   * which is strictly worse.
   */
  getTrustPromptPatterns(): string[] { return []; }

  /** Empty, for the same reason as getTrustPromptPatterns. */
  getContextPromptPatterns(): string[] { return []; }

  // ─── UI metadata ─────────────────────────────────────────────────

  getModelList() { return KIMI_MODELS; }
  getPermissionModes(): PermissionMode[] { return KIMI_PERMISSION_MODES; }

  // ─── Session discovery on disk ───────────────────────────────────

  /**
   * Sessions come from `session_index.jsonl`, which maps sessionId → sessionDir
   * → workDir directly. That avoids having to re-derive Kimi's `workDirKey`
   * bucket name (`wd_<slug>_<sha256-12>`) ourselves.
   *
   * COST: one whole-file read of the index + up to two stats and one small
   * state.json read per session. Call from UI flows only, not render paths.
   */
  discoverSessions(): DiscoveredSession[] {
    // Short-TTL cache, matching Claude/Copilot: the resume modal and the
    // periodic scanner both hit this, and the sync disk walk would otherwise
    // block the event loop repeatedly.
    const now = Date.now();
    if (kimiDiscoverCache && now - kimiDiscoverCache.ts < KIMI_DISCOVER_TTL_MS) {
      return kimiDiscoverCache.sessions;
    }
    const sessions = this.discoverSessionsUncached();
    kimiDiscoverCache = { sessions, ts: now };
    return sessions;
  }

  private discoverSessionsUncached(): DiscoveredSession[] {
    const results: DiscoveredSession[] = [];

    for (const entry of readSessionIndex()) {
      const sessionDir = resolveSessionDir(entry.sessionDir);
      if (!sessionDir || !existsSync(sessionDir)) continue;  // pruned on disk

      const transcript = wirePath(sessionDir);
      const hasTranscript = existsSync(transcript);

      let lastModified: number | undefined;
      try {
        // The wire log is the thing that actually changes as a session runs;
        // fall back to the directory when it has not been written yet.
        lastModified = statSync(hasTranscript ? transcript : sessionDir).mtimeMs;
      } catch { /* keep partial data */ }

      results.push({
        id: entry.sessionId,
        cwd: entry.workDir || undefined,
        name: readSessionTitle(sessionDir),
        transcriptPath: hasTranscript ? transcript : undefined,
        lastModified,
      });
    }

    return results;
  }

  /** COST: one read of session_index.jsonl. */
  findSessionCwd(sessionId: string): string | undefined {
    if (!KIMI_SESSION_ID_RE.test(sessionId)) return undefined;
    const entry = readSessionIndex().find(e => e.sessionId === sessionId);
    return entry?.workDir || undefined;
  }

  /**
   * `sessions/<workDirKey>/<sessionId>/agents/main/wire.jsonl` — documented as
   * "the main Agent's complete communication record, used for session
   * resumption and replay". Located via the index; falls back to scanning the
   * workDirKey buckets when the index is missing or stale.
   */
  getTranscriptPath(sessionId: string): string | undefined {
    if (!KIMI_SESSION_ID_RE.test(sessionId)) return undefined;

    const entry = readSessionIndex().find(e => e.sessionId === sessionId);
    const indexed = entry && resolveSessionDir(entry.sessionDir);
    if (indexed) {
      const path = wirePath(indexed);
      if (existsSync(path)) return path;
    }

    // Index miss: the layout is fixed, so probe each workDirKey bucket.
    if (!existsSync(KIMI_SESSIONS_DIR)) return undefined;
    let buckets: string[];
    try {
      buckets = readdirSync(KIMI_SESSIONS_DIR);
    } catch {
      return undefined;
    }
    for (const bucket of buckets) {
      const path = wirePath(join(KIMI_SESSIONS_DIR, bucket, sessionId));
      if (existsSync(path)) return path;
    }
    return undefined;
  }

  /**
   * false — not handled at the disk level. Kimi's session title lives in
   * `state.json` and is set in-TUI by `/title <text>` (alias `/rename`).
   * UNVERIFIED: whether Kimi re-reads state.json, or clobbers it on its next
   * write, if we edit `title` underneath a running session. Copilot's
   * workspace.yaml rewrite was verified safe; nothing equivalent was verified
   * here, so this returns false (as ClaudeProvider does) and callers fall back
   * to injecting `/title` into the PTY.
   */
  renameSession(_sessionId: string, _newName: string): boolean {
    return false;
  }

  // ─── Process detection ───────────────────────────────────────────

  /**
   * PARTIAL BY CONSTRUCTION — only finds RESUMED sessions.
   *
   * Kimi has no `--session-id` flag, so a newly-started session's id appears
   * nowhere on its command line, and Kimi documents no per-session lock file of
   * the kind Copilot's `inuse.<PID>.lock` provides. The only id observable from
   * outside the process is the one passed to `--session`/`-S` on resume, which
   * is what this parses.
   *
   * Under-reporting is the safe direction: the OrphanReaper treats an
   * undetected session as not-running rather than killing a live one.
   *
   * COST: spawns one `wmic`/`ps`; cached and refreshed asynchronously so a
   * resume-modal open never blocks on it.
   */
  detectActiveSessionIds(): ActiveProcessInfo[] {
    const now = Date.now();
    if (kimiActiveCache) {
      if (now - kimiActiveCache.ts >= KIMI_ACTIVE_TTL_MS) refreshKimiActiveAsync();
      return kimiActiveCache.result;
    }
    // Cold start: one synchronous read seeds the cache (typically the startup
    // scan); every later call is served from cache and refreshed in background.
    const { cmd, args } = kimiProcCommand();
    try {
      const output = execFileSync(cmd, args, { encoding: 'utf-8', timeout: 5000, windowsHide: true });
      kimiActiveCache = { result: parseKimiProcessLines(output), ts: now };
    } catch {
      kimiActiveCache = { result: [], ts: now };
    }
    return kimiActiveCache.result;
  }
}

// Short-TTL cache for the index scan (see discoverSessions).
const KIMI_DISCOVER_TTL_MS = 4000;
let kimiDiscoverCache: { sessions: DiscoveredSession[]; ts: number } | null = null;

// Async-refreshed cache for process detection (see detectActiveSessionIds).
const KIMI_ACTIVE_TTL_MS = 4000;
let kimiActiveCache: { result: ActiveProcessInfo[]; ts: number } | null = null;
let kimiActiveRefreshing = false;

function kimiProcCommand(): { cmd: string; args: string[] } {
  if (process.platform === 'win32') {
    // Kimi is a Node CLI (`dist/main.mjs`), so it may report as node.exe.
    return {
      cmd: 'wmic',
      args: ['process', 'where', "name='kimi.exe' or name='node.exe'", 'get', 'CommandLine', '/format:csv'],
    };
  }
  return { cmd: '/bin/sh', args: ['-c', "ps -eo args | grep '[k]imi' | grep -- '--session'"] };
}

/**
 * Extract session ids from `--session <id>` / `-S <id>` on Kimi command lines.
 *
 * Pure (string in, records out) so it is unit-testable without a Kimi install.
 * Only lines that actually mention kimi are considered, because the Windows
 * `wmic` query above deliberately over-collects `node.exe`.
 */
export function parseKimiProcessLines(output: string): ActiveProcessInfo[] {
  const result: ActiveProcessInfo[] = [];
  for (const line of output.split('\n')) {
    if (!/kimi/i.test(line)) continue;
    // `--session` may also appear with no id (interactive selector), in which
    // case the next token is the FOLLOWING FLAG. Requiring an alphanumeric
    // first character rejects `--yolo` and friends — without it, `kimi
    // --session --yolo` would report a phantom session called "--yolo" and the
    // OrphanReaper would chase an id that does not exist.
    const match = line.match(/(?:--session|-S)[=\s]+([A-Za-z0-9_][A-Za-z0-9_-]{5,63})\b/);
    if (!match) continue;
    result.push({ sessionId: match[1] });
  }
  return result;
}

function refreshKimiActiveAsync(): void {
  if (kimiActiveRefreshing) return;
  kimiActiveRefreshing = true;
  const { cmd, args } = kimiProcCommand();
  execFile(cmd, args, { encoding: 'utf-8', timeout: 5000, windowsHide: true }, (err, stdout) => {
    kimiActiveRefreshing = false;
    if (err) return; // keep the previous cache on failure
    kimiActiveCache = { result: parseKimiProcessLines(stdout || ''), ts: Date.now() };
  });
}
