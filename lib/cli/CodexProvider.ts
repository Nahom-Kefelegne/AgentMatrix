import { execSync, execFile, execFileSync } from 'child_process';
import { existsSync, readdirSync, statSync, openSync, readSync, closeSync } from 'fs';
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
import { pickSpawnableBinary } from './binaryPath';
import { CODEX_MODELS, CODEX_PERMISSION_MODES } from './uiMetadata';

/**
 * Provider for OpenAI Codex CLI — npm `@openai/codex`, binary `codex`, repo
 * https://github.com/openai/codex (Apache-2.0).
 *
 * SOURCES. Codex CLI was NOT installed on the machine this provider was written
 * on (`where codex` found nothing, and it is not in the npm globals), so — as
 * with KimiProvider — nothing here is confirmed against a live binary the way
 * ClaudeProvider/CopilotProvider were. Every flag, subcommand, path and model id
 * below traces to something actually read:
 *
 *   - Subcommand list, `resume`/`fork` shape:
 *     codex-rs/cli/src/main.rs (clap definitions, read from raw.githubusercontent)
 *   - Interactive (TUI) flags: codex-rs/tui/src/cli.rs
 *   - Non-interactive (`exec`) flags: codex-rs/exec/src/cli.rs
 *   - Shared flags (`--model`, `--sandbox`, `--add-dir`, `--cd`,
 *     `--dangerously-bypass-approvals-and-sandbox` + its `yolo` alias):
 *     codex-rs/utils/cli/src/shared_options.rs
 *   - Approval values: codex-rs/utils/cli/src/approval_mode_cli_arg.rs
 *   - Sandbox values:  codex-rs/utils/cli/src/sandbox_mode_cli_arg.rs
 *   - `-c/--config`:   codex-rs/utils/cli/src/config_override.rs
 *   - Rollout layout (`sessions/` + `archived_sessions/`, YYYY/MM/DD, filename
 *     scheme): codex-rs/rollout/src/lib.rs, recorder.rs, rollout_file_name.rs
 *   - First-run trust prompt wording:
 *     codex-rs/tui/src/onboarding/trust_directory.rs
 *   - Install commands + binary name: openai/codex README.md
 *   - Model ids, slash commands, CLI reference prose:
 *     https://learn.chatgpt.com/docs/models,
 *     https://learn.chatgpt.com/docs/cli/reference,
 *     https://learn.chatgpt.com/docs/developer-commands?surface=cli
 *     (the canonical developers.openai.com/codex/* URLs 308-redirect there; the
 *     repo's own docs/*.md are now one-line stubs pointing at the same pages)
 *
 * ANYTHING NOT IN THOSE SOURCES IS MARKED "UNVERIFIED" AND DEGRADES TO
 * null/empty/false rather than guessing. The UNVERIFIED comments are the
 * checklist for whoever gets to run `codex` for real.
 */

/**
 * Generic terminal-caret mark, authored for this file — NOT OpenAI's brand
 * logo. ClaudeProvider/CopilotProvider embed real, licensed brand SVGs
 * (claude.ai favicon, primer/octicons). No equivalently verifiable OpenAI asset
 * was found under a known license, and drawing brand art from memory is worse
 * than shipping a neutral glyph. Swap in the official mark when one is
 * available under a license that permits it.
 */
const CODEX_ICON_SVG = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
  <rect x="1.2" y="2.4" width="13.6" height="11.2" rx="2.2"/>
  <path d="M4.6 6.2 6.9 8l-2.3 1.8"/>
  <path d="M8.6 10.4h2.9"/>
</svg>`;

/**
 * Data root. Verified: user config lives at `$CODEX_HOME/config.toml`, and
 * `--profile <name>` is documented as layering `$CODEX_HOME/<name>.config.toml`
 * (codex-rs/utils/cli/src/shared_options.rs). The default is `~/.codex`.
 *
 * UNVERIFIED: whether Windows uses `%USERPROFILE%\.codex` or a platform
 * app-data directory. Nothing in the sources read says Codex diverges per
 * platform the way some CLIs do, and `~/.codex` is what the docs show, so
 * `homedir()/.codex` is used everywhere. If Codex turns out to use
 * `%LOCALAPPDATA%` on Windows, session discovery silently finds nothing here —
 * that is the first thing to re-check on a real Windows install.
 */
const CODEX_HOME = process.env.CODEX_HOME || join(homedir(), '.codex');

/**
 * Verified layout under the data root (codex-rs/rollout/src/lib.rs defines
 * `SESSIONS_SUBDIR = "sessions"` and `ARCHIVED_SESSIONS_SUBDIR =
 * "archived_sessions"`; recorder.rs pushes the sessions subdir then year, then
 * zero-padded month, then zero-padded day):
 *
 *   sessions/<YYYY>/<MM>/<DD>/rollout-<timestamp>-<thread_id>.jsonl
 *   archived_sessions/…                        (same shape; `codex archive`)
 *
 * Only `sessions/` is scanned: an archived session is one the user explicitly
 * hid, and surfacing it in the resume list would undo that.
 */
const CODEX_SESSIONS_DIR = join(CODEX_HOME, 'sessions');

/**
 * Verified filename scheme (codex-rs/rollout/src/rollout_file_name.rs):
 *   `rollout-` + `[year]-[month]-[day]T[hour]-[minute]-[second]` + `-`
 *   + thread_id, optionally + `_` + rollout_id (only for reverted threads),
 *   + `.jsonl`
 */
const CODEX_ROLLOUT_PREFIX = 'rollout-';
const CODEX_ROLLOUT_SUFFIX = '.jsonl';

/**
 * Codex session ids are UUIDs — `codex resume`'s positional argument is
 * documented in main.rs as "Session id (UUID) or session name. UUIDs take
 * precedence if it parses." Everything this provider reads off disk comes from
 * a rollout's `payload.id`, which is that UUID, so the guard asserts UUID shape
 * rather than a permissive character class: it is interpolated into filename
 * matching, and a strict test is the cheapest way to keep separators out.
 *
 * Session NAMES (settable in-TUI via `/rename`) are deliberately not accepted
 * here. They are valid for `codex resume`, but they are not what discovery
 * produces, and they have no verified character set.
 */
const CODEX_UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

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
function readFirstBytes(path: string, bytes = 8000): string {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const n = readSync(fd, buf, 0, bytes, 0);
    return buf.toString('utf-8', 0, n);
  } finally {
    closeSync(fd);
  }
}

// ─── Rollout parsing (pure, unit-tested) ───────────────────────────

/** The fields this provider needs out of a rollout's `session_meta` line. */
export interface CodexSessionMeta {
  /** `payload.id` — the thread/session UUID. */
  id: string;
  /** `payload.cwd` — the directory the session was started in. */
  cwd?: string;
}

/**
 * Parse the head of a rollout `.jsonl` and return its session metadata.
 *
 * Verified shape: each line is a `RolloutLine` — `{"timestamp":…,"type":…,
 * "payload":{…}}` — and the first line of a rollout is the `session_meta`
 * record, whose payload carries `id`, `cwd`, `originator`, `cli_version` and
 * friends (codex-rs/rollout/src/metadata.rs reads `meta.id` / `meta.cwd` /
 * `meta.cli_version` off a `SessionMetaLine`; a real captured rollout in the
 * wild has the form
 * `{"timestamp":"…","type":"session_meta","payload":{"id":"<uuid>","cwd":"…",
 * "originator":"codex_vscode","cli_version":"…"}}`).
 *
 * Defensive about position: the first few lines are scanned rather than only
 * line 0, so a future preamble record does not blind discovery. Returns null
 * when no session_meta is found in the scanned window.
 *
 * Pure (string in, record out) so it is unit-testable without a Codex install.
 */
export function parseCodexSessionMeta(text: string, maxLines = 10): CodexSessionMeta | null {
  const lines = text.split('\n');
  const limit = Math.min(lines.length, maxLines);
  for (let i = 0; i < limit; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // A truncated final line is normal (the recorder appends live), and the
      // header read is byte-bounded so the window's last line is usually cut.
      continue;
    }
    if (!parsed || typeof parsed !== 'object') continue;
    const record = parsed as Record<string, unknown>;
    if (record.type !== 'session_meta') continue;
    const payload = record.payload;
    if (!payload || typeof payload !== 'object') continue;
    const fields = payload as Record<string, unknown>;
    const id = typeof fields.id === 'string' ? fields.id : '';
    if (!id) continue;
    const cwd = typeof fields.cwd === 'string' && fields.cwd ? fields.cwd : undefined;
    return cwd === undefined ? { id } : { id, cwd };
  }
  return null;
}

/**
 * Does this rollout filename belong to the given session id?
 *
 * `rollout-<ts>-<thread_id>.jsonl`, or `rollout-<ts>-<thread_id>_<rollout_id>
 * .jsonl` when a thread has been reverted. Matching on the id rather than
 * re-deriving the timestamp keeps this independent of the timestamp format.
 *
 * Pure so it is unit-testable without a Codex install.
 */
export function rolloutFileMatchesSessionId(fileName: string, sessionId: string): boolean {
  if (!CODEX_UUID_RE.test(sessionId)) return false;
  if (!fileName.startsWith(CODEX_ROLLOUT_PREFIX) || !fileName.endsWith(CODEX_ROLLOUT_SUFFIX)) {
    return false;
  }
  const stem = fileName.slice(CODEX_ROLLOUT_PREFIX.length, -CODEX_ROLLOUT_SUFFIX.length);
  const lower = stem.toLowerCase();
  const id = sessionId.toLowerCase();
  return lower.endsWith(`-${id}`) || lower.includes(`-${id}_`);
}

// ─── Argument building (pure, unit-tested) ─────────────────────────

/**
 * Map an AgentMatrix permission mode onto Codex's flags.
 *
 * Codex splits what other CLIs fuse into ONE control across two independent
 * axes, both verified:
 *   --sandbox / -s          read-only | workspace-write | danger-full-access
 *   --ask-for-approval / -a untrusted | on-request | never
 * plus one escape hatch that turns both off at once:
 *   --dangerously-bypass-approvals-and-sandbox   (alias: --yolo)
 *
 * `default` emits NOTHING on purpose. Codex picks its own pairing by detecting
 * version control on startup (docs: workspace-write + on-request in a tracked
 * repo, read-only outside one), and hardcoding one of those here would override
 * a decision the CLI makes better.
 *
 * Any unrecognised value — including Claude's `acceptEdits` and `plan`, which
 * have no Codex counterpart — also emits nothing, rather than being mapped to
 * something approximate that would grant more or less than the caller asked.
 */
function permissionFlags(permissionMode: string | undefined): string[] {
  switch (permissionMode) {
    case 'bypassPermissions':
      // The long form, not the `--yolo` alias: it is the name in the source,
      // and it says what it does in a `ps` listing.
      return ['--dangerously-bypass-approvals-and-sandbox'];
    case 'read-only':
      return ['--sandbox', 'read-only'];
    case 'workspace-write':
      return ['--sandbox', 'workspace-write'];
    case 'never-ask':
      // Sandbox still enforced (whatever Codex picks for the folder); only the
      // approval pauses are suppressed. Verified value: "never" — "Never ask
      // for user approval. Execution failures are immediately returned to the
      // model."
      return ['--ask-for-approval', 'never'];
    default:
      return [];
  }
}

/**
 * Flags shared by new sessions and resumes. `codex resume`'s clap struct
 * flattens the same TUI options as a bare `codex`, so `--model`/`--sandbox`/
 * `--ask-for-approval` are accepted on both.
 */
function commonFlags(opts: { permissionMode?: string; model?: string }): string[] {
  const args = permissionFlags(opts.permissionMode);
  if (opts.model) args.push('--model', opts.model);
  return args;
}

/**
 * Build argv for a NEW interactive Codex session.
 *
 * DELIBERATELY IGNORED, because Codex documents no flag for them:
 *   - `opts.sessionId` — there is NO `--session-id` equivalent. Codex mints the
 *     thread UUID itself; `resume`/`fork` take an id, they do not set one.
 *     Consequence, exactly as for Kimi: AgentMatrix's tracking id will NOT
 *     equal Codex's on-disk session id for new sessions. Callers that rely on
 *     that identity (transcript lookup, active-process detection) must map
 *     through the rollout's `session_meta` line instead — see
 *     `discoverSessions` / `getTranscriptPath`.
 *   - `opts.name` — no `-n` equivalent; names are set in-TUI via `/rename`.
 *   - `opts.effort` — there is NO `--effort` / `--reasoning-effort` flag on
 *     any of `codex`, `codex exec`, or the shared options. Reasoning effort is
 *     a config key (`model_reasoning_effort`), reachable only through the
 *     generic `-c key=value` override. UNVERIFIED: the accepted value set for
 *     that key — the docs render the picker as "Low / Medium / High / Extra
 *     high / Max / Ultra" without giving the config slugs, and guessing a slug
 *     would either error out or silently fall back. So effort is dropped, and
 *     `CLI_UI_CAPABILITIES.codex.effort` is false so the control is hidden.
 *   - `opts.allowedTools` — no per-tool allow-list flag.
 *   - `opts.systemPrompt` — no `--append-system-prompt` equivalent.
 *
 * `opts.cwd` is applied by the spawner as the process working directory. Codex
 * does have `--cd`/`-C` ("Tell the agent to use the specified directory as its
 * working root"), but setting the process cwd is what every other provider here
 * does and it keeps `ps` output honest.
 */
export function buildCodexSpawnArgs(opts: SpawnOptions): string[] {
  const args = commonFlags(opts);
  // Verified: `--add-dir` is `Vec<PathBuf>`, "Additional directories that
  // should be writable alongside the primary workspace" — so it is repeated per
  // directory, not comma-joined.
  //
  // NOTE ON SCOPE: `SpawnOptions.addDirs` is documented as "extra directories
  // the agent may READ outside cwd" (context handoff needs the previous CLI's
  // transcript directory). Codex's flag grants WRITE. That is a widening, and
  // it is deliberate: it is the only documented way to name an extra directory
  // to Codex at all, and the alternative — dropping `addDirs` — silently breaks
  // handoff, which is the failure mode AGENTS.md §2 exists to prevent.
  for (const dir of opts.addDirs ?? []) args.push('--add-dir', dir);
  return args;
}

/**
 * Build argv to resume (or fork) a session.
 *
 * Verified: `resume` is a top-level subcommand — "Resume a previous interactive
 * session" — whose clap struct takes a positional `SESSION_ID` ("Session id
 * (UUID) or session name") and flattens the normal TUI options. `fork` is its
 * sibling with an identical shape: "Fork a previous interactive session."
 *
 * Unlike Claude's `--fork-session` modifier, Codex's fork is a DIFFERENT
 * subcommand, so `opts.fork` selects the verb rather than adding a flag.
 *
 * `--last` and `--all` are not used: both are picker behaviours for when no id
 * is supplied, and AgentMatrix always has an id.
 */
export function buildCodexResumeArgs(opts: ResumeOptions): string[] {
  const args = [opts.fork ? 'fork' : 'resume', opts.resumeId];
  args.push(...commonFlags(opts));
  return args;
}

export class CodexProvider implements CliProvider {
  readonly type: CliType = 'codex';
  readonly configDir = CODEX_HOME;
  readonly displayName = 'Codex CLI';
  /** Placeholder mark — see CODEX_ICON_SVG. */
  readonly iconSvg = CODEX_ICON_SVG;
  /** UNVERIFIED as an official brand token; chosen to read well in the session
   *  list and to stay distinct from Claude's orange and Copilot's purple. */
  readonly iconColor = '#10A37F';

  // ─── Capability flags ────────────────────────────────────────────
  /**
   * false. Codex DOES support MCP servers (`codex mcp`, `codex mcp-server`),
   * but this flag specifically means "accepts an MCP-aware system-prompt
   * injection", i.e. Claude's `--append-system-prompt`. No such flag exists on
   * any Codex subcommand, so AgentMatrix cannot inject its context this way.
   */
  readonly supportsMcp = false;
  /**
   * true — verified. `codex fork <SESSION_ID>` is a first-class subcommand
   * ("Fork a previous interactive session"), with the same argument shape as
   * `codex resume`. See buildCodexResumeArgs.
   */
  readonly supportsFork = true;
  /**
   * false. Codex's TUI does show context usage, but its on-screen format was
   * never observed here, and a wrong regex reports a wrong gauge rather than no
   * gauge. See parseContextUsage / getContextUsage.
   */
  readonly supportsContextTracking = false;
  /**
   * false. Codex has subagent-shaped features, but this flag means "emits
   * SubagentStart/SubagentStop hooks AgentMatrix can observe", which is
   * unverified. Claiming it would make the fleet UI wait on events that may
   * never arrive.
   */
  readonly supportsSubagents = false;
  /**
   * false. Codex has NO Agent Client Protocol mode. It ships two other stdio
   * protocols — `codex mcp-server` ("Start Codex as an MCP server (stdio)") and
   * `codex app-server` (its own JSON-RPC, `--listen stdio://`) — and neither is
   * ACP. Mapping either onto `supportsAcp` would make AcpClient speak the wrong
   * protocol at a process that answers.
   */
  readonly supportsAcp = false;

  // ─── Binary + health ─────────────────────────────────────────────

  findBinary(): string {
    try {
      const cmd = process.platform === 'win32' ? 'where codex' : 'which codex';
      const output = execSync(cmd, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      // Windows lists the extensionless npm shim first; CreateProcess rejects
      // it with error 193, so always pick an executable extension.
      const result = pickSpawnableBinary(output.trim().split(/\r?\n/));
      if (result) return result;
    } catch { /* ignore */ }

    // Fallback locations. Verified install routes (openai/codex README):
    // `npm install -g @openai/codex`, `brew install --cask codex`, and the
    // install scripts at https://chatgpt.com/codex/install.sh / install.ps1.
    // UNVERIFIED: the directory those install scripts target, so only the npm,
    // Homebrew and conventional user-bin locations are probed. The PATH lookup
    // above is the real mechanism; this is a courtesy.
    const home = homedir();
    const candidates = process.platform === 'win32'
      ? [
          join(home, 'AppData', 'Roaming', 'npm', 'codex.cmd'),
          join(home, '.codex', 'bin', 'codex.exe'),
        ]
      : [
          '/usr/local/bin/codex',
          '/opt/homebrew/bin/codex',
          join(home, '.local', 'bin', 'codex'),
          join(home, '.npm-global', 'bin', 'codex'),
        ];

    for (const p of candidates) {
      if (existsSync(p)) return p;
    }

    throw new Error('Codex CLI not found. Install it (npm i -g @openai/codex) or add it to PATH.');
  }

  checkHealth(): CliHealth {
    try {
      const binaryPath = this.findBinary();
      const version = execSync(`"${binaryPath}" --version`, {
        encoding: 'utf-8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      return { type: 'codex', installed: true, version, binaryPath };
    } catch {
      let binaryPath: string | null = null;
      try { binaryPath = this.findBinary(); } catch { /* not found */ }

      return {
        type: 'codex',
        installed: false,
        version: null,
        binaryPath,
        error: binaryPath
          ? `Binary found at ${binaryPath} but version check failed`
          : 'Codex CLI not found. Install it (npm i -g @openai/codex) or add it to PATH.',
      };
    }
  }

  // ─── Spawn / resume ──────────────────────────────────────────────

  buildSpawnArgs(opts: SpawnOptions): string[] { return buildCodexSpawnArgs(opts); }
  buildResumeArgs(opts: ResumeOptions): string[] { return buildCodexResumeArgs(opts); }

  buildResumeShellCommand(opts: ResumeOptions): string {
    return `codex ${this.buildResumeArgs(opts).join(' ')}`;
  }

  getExitSequence(): Array<{ data: string; delayMs: number }> {
    // Documented: `/quit` "Exit the CLI"; `/exit` is listed as an alternative
    // spelling for the same thing. Ctrl-C is also documented as closing the
    // session, but the slash command matches what ClaudeProvider does and is
    // the graceful path.
    //
    // UNVERIFIED against a live TUI: whether `/quit` flushes the rollout file
    // before exiting. If a truncated final rollout line ever shows up, this is
    // the first thing to re-check.
    return [{ data: '/quit\r', delayMs: 0 }];
  }

  // ─── TUI parsing ─────────────────────────────────────────────────

  /**
   * UNVERIFIED: Codex's actual prompt glyph was never observed. This reuses the
   * generic trailing-prompt heuristic Claude, Copilot and Kimi all use, which is
   * a guess about Codex specifically. Returning `false` unconditionally would be
   * "safer" but would stall every caller that waits for readiness, so a
   * permissive heuristic is the better failure mode. Confirm against a live TUI.
   */
  detectPromptReady(text: string): boolean {
    const clean = stripAnsi(text).trim();
    return /[$❯›>]\s*$/.test(clean);
  }

  /**
   * null always. Codex's TUI does render context usage, but its on-screen
   * format is unverified, and a wrong regex silently reports a wrong gauge
   * rather than no gauge. Implement once the real output is known.
   */
  parseContextUsage(_text: string): number | null {
    return null;
  }

  /**
   * null always. Codex keeps a SQLite state store alongside the rollouts
   * (codex-rs/rollout/src/state_db.rs), and the rollout stream itself carries
   * per-turn records — but neither schema was verified here, and Copilot's
   * equivalent only works because its session-store.db columns were read off a
   * real install. Reporting a fabricated percentage is worse than reporting
   * none.
   */
  async getContextUsage(_sessionId: string): Promise<number | null> {
    return null;
  }

  /**
   * Verified verbatim from codex-rs/tui/src/onboarding/trust_directory.rs — the
   * first-run screen an unhandled modal would otherwise hang forever on:
   *
   *   "Do you trust the contents of this directory? Working with untrusted
   *    contents comes with higher risk of prompt injection. Trusting the
   *    directory allows project-local config, hooks, and exec policies to load."
   *   options: "Yes, continue" / "No, quit"
   *
   * Only distinctive fragments are listed; "Yes, continue" alone is too generic
   * to use as a trigger.
   *
   * UNVERIFIED: which option is highlighted when the screen opens. The watcher
   * answers by sending Enter, which takes the DEFAULT selection — if that
   * default is ever "No, quit", auto-accepting would kill the session instead
   * of trusting the folder. Re-check this against a real first run before
   * relying on unattended spawns in fresh directories.
   */
  getTrustPromptPatterns(): string[] {
    return [
      'Do you trust the contents of this directory?',
      'higher risk of prompt injection',
      'Trusting will apply to the repository root',
    ];
  }

  /**
   * Empty. No Codex equivalent of Claude's "this conversation is getting long"
   * resume prompt was found in the sources read. An empty list means the
   * watcher simply does not auto-accept; a wrong string would send Enter at an
   * unknown prompt, which is strictly worse.
   */
  getContextPromptPatterns(): string[] { return []; }

  // ─── UI metadata ─────────────────────────────────────────────────

  getModelList() { return CODEX_MODELS; }
  getPermissionModes(): PermissionMode[] { return CODEX_PERMISSION_MODES; }

  // ─── Session discovery on disk ───────────────────────────────────

  /**
   * Walk `sessions/<YYYY>/<MM>/<DD>/rollout-*.jsonl` and read each rollout's
   * `session_meta` header for its id and cwd.
   *
   * The date buckets are walked newest-first and the scan stops after
   * CODEX_MAX_DISCOVERED sessions: a long-lived Codex install accumulates one
   * file per session with no pruning, and this is a synchronous walk on the
   * event loop. Truncating the OLDEST is the right direction — the resume modal
   * sorts by recency anyway — but it does mean this is not exhaustive, which is
   * why the cap is a named constant rather than a magic number.
   *
   * COST: three shallow readdirs per day-bucket plus one 8KB header read per
   * session. Call from UI flows only, not render paths.
   */
  discoverSessions(): DiscoveredSession[] {
    // Short-TTL cache, matching Claude/Copilot/Kimi: the resume modal and the
    // periodic scanner both hit this, and the sync disk walk would otherwise
    // block the event loop repeatedly.
    const now = Date.now();
    if (codexDiscoverCache && now - codexDiscoverCache.ts < CODEX_DISCOVER_TTL_MS) {
      return codexDiscoverCache.sessions;
    }
    const sessions = this.discoverSessionsUncached();
    codexDiscoverCache = { sessions, ts: now };
    return sessions;
  }

  private discoverSessionsUncached(): DiscoveredSession[] {
    const results: DiscoveredSession[] = [];
    for (const file of listRolloutFiles(CODEX_MAX_DISCOVERED)) {
      const meta = readRolloutMeta(file);
      if (!meta) continue;  // no session_meta header → not a usable rollout

      let lastModified: number | undefined;
      try {
        lastModified = statSync(file).mtimeMs;
      } catch { /* keep partial data */ }

      results.push({
        id: meta.id,
        cwd: meta.cwd,
        // No name. Codex sessions CAN be named (`/rename`), but where that name
        // is persisted was not verified — it is not in the `session_meta`
        // header, and the SQLite state store's schema is unknown. Leaving it
        // undefined lets the UI fall back to the id; inventing one from the
        // filename would show the user a timestamp pretending to be a title.
        transcriptPath: file,
        lastModified,
      });
    }
    return results;
  }

  /** COST: up to CODEX_MAX_DISCOVERED header reads, short-circuited on a hit. */
  findSessionCwd(sessionId: string): string | undefined {
    const path = this.getTranscriptPath(sessionId);
    if (!path) return undefined;
    return readRolloutMeta(path)?.cwd;
  }

  /**
   * `sessions/<YYYY>/<MM>/<DD>/rollout-<timestamp>-<id>.jsonl`. Located by
   * matching the id against rollout filenames (see
   * `rolloutFileMatchesSessionId`) rather than by re-deriving the timestamp,
   * which would require reproducing Codex's exact clock formatting.
   */
  getTranscriptPath(sessionId: string): string | undefined {
    if (!CODEX_UUID_RE.test(sessionId)) return undefined;
    for (const file of listRolloutFiles(CODEX_MAX_DISCOVERED)) {
      if (rolloutFileMatchesSessionId(basename(file), sessionId)) return file;
    }
    return undefined;
  }

  /**
   * false — not handled at the disk level. Codex names sessions in-TUI via
   * `/rename`, and where that name is persisted was not verified (it is not in
   * the rollout's `session_meta` header; the SQLite state store is a candidate
   * but its schema is unknown). Writing a guess into someone's session store is
   * not a recoverable mistake, so this returns false (as ClaudeProvider does)
   * and callers fall back to injecting `/rename` into the PTY.
   */
  renameSession(_sessionId: string, _newName: string): boolean {
    return false;
  }

  // ─── Process detection ───────────────────────────────────────────

  /**
   * PARTIAL BY CONSTRUCTION — only finds RESUMED and FORKED sessions.
   *
   * Codex has no `--session-id` flag, so a newly-started session's id appears
   * nowhere on its command line, and no per-session lock file of the kind
   * Copilot's `inuse.<PID>.lock` provides was found. The only id observable
   * from outside the process is the positional argument to `codex resume` /
   * `codex fork`, which is what this parses.
   *
   * Under-reporting is the safe direction: the OrphanReaper treats an
   * undetected session as not-running rather than killing a live one.
   *
   * COST: spawns one `wmic`/`ps`; cached and refreshed asynchronously so a
   * resume-modal open never blocks on it.
   */
  detectActiveSessionIds(): ActiveProcessInfo[] {
    const now = Date.now();
    if (codexActiveCache) {
      if (now - codexActiveCache.ts >= CODEX_ACTIVE_TTL_MS) refreshCodexActiveAsync();
      return codexActiveCache.result;
    }
    // Cold start: one synchronous read seeds the cache (typically the startup
    // scan); every later call is served from cache and refreshed in background.
    const { cmd, args } = codexProcCommand();
    try {
      const output = execFileSync(cmd, args, { encoding: 'utf-8', timeout: 5000, windowsHide: true });
      codexActiveCache = { result: parseCodexProcessLines(output), ts: now };
    } catch {
      codexActiveCache = { result: [], ts: now };
    }
    return codexActiveCache.result;
  }
}

// ─── Disk helpers ──────────────────────────────────────────────────

/** Last path segment, without importing `path.basename` per call site. */
function basename(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i === -1 ? p : p.slice(i + 1);
}

/**
 * Upper bound on how many rollout files a single scan will look at. Codex never
 * prunes `sessions/`, so an old install can hold thousands; this walk is
 * synchronous and would otherwise stall the event loop for seconds.
 */
const CODEX_MAX_DISCOVERED = 300;

/** Numeric-ish directory entries, newest (highest) first. */
function sortedBucketsDesc(dir: string): string[] {
  try {
    return readdirSync(dir).filter(n => /^\d+$/.test(n)).sort().reverse();
  } catch {
    return [];
  }
}

/**
 * Absolute paths of rollout files, newest date-bucket first, capped at `limit`.
 *
 * Ordering is by the YYYY/MM/DD directory structure and then by filename —
 * which begins with the session's timestamp, so lexical order IS chronological
 * order (verified: the filename timestamp is fixed-width
 * `[year]-[month]-[day]T[hour]-[minute]-[second]`).
 */
function listRolloutFiles(limit: number): string[] {
  if (!existsSync(CODEX_SESSIONS_DIR)) return [];
  const out: string[] = [];
  for (const year of sortedBucketsDesc(CODEX_SESSIONS_DIR)) {
    const yearDir = join(CODEX_SESSIONS_DIR, year);
    for (const month of sortedBucketsDesc(yearDir)) {
      const monthDir = join(yearDir, month);
      for (const day of sortedBucketsDesc(monthDir)) {
        const dayDir = join(monthDir, day);
        let entries: string[];
        try {
          entries = readdirSync(dayDir);
        } catch {
          continue;
        }
        const rollouts = entries
          .filter(n => n.startsWith(CODEX_ROLLOUT_PREFIX) && n.endsWith(CODEX_ROLLOUT_SUFFIX))
          .sort()
          .reverse();
        for (const name of rollouts) {
          out.push(join(dayDir, name));
          if (out.length >= limit) return out;
        }
      }
    }
  }
  return out;
}

/** Read + parse a rollout's session_meta header, or undefined on any failure. */
function readRolloutMeta(path: string): CodexSessionMeta | undefined {
  try {
    return parseCodexSessionMeta(readFirstBytes(path)) ?? undefined;
  } catch {
    return undefined;
  }
}

// Short-TTL cache for the rollout walk (see discoverSessions).
const CODEX_DISCOVER_TTL_MS = 4000;
let codexDiscoverCache: { sessions: DiscoveredSession[]; ts: number } | null = null;

// Async-refreshed cache for process detection (see detectActiveSessionIds).
const CODEX_ACTIVE_TTL_MS = 4000;
let codexActiveCache: { result: ActiveProcessInfo[]; ts: number } | null = null;
let codexActiveRefreshing = false;

function codexProcCommand(): { cmd: string; args: string[] } {
  if (process.platform === 'win32') {
    // Codex is a native Rust binary (the npm package wraps a per-platform
    // executable), so — unlike Kimi — it does not masquerade as node.exe.
    return {
      cmd: 'wmic',
      args: ['process', 'where', "name='codex.exe'", 'get', 'CommandLine', '/format:csv'],
    };
  }
  return { cmd: '/bin/sh', args: ['-c', "ps -eo args | grep '[c]odex' | grep -E 'resume|fork'"] };
}

/**
 * Extract session ids from `codex resume <id>` / `codex fork <id>` command
 * lines.
 *
 * Only UUIDs are accepted. `resume` also takes a session NAME, and `--last`
 * takes nothing at all — matching a loose token would turn `codex resume
 * --last` into a phantom session called "--last" and send the OrphanReaper
 * chasing an id that does not exist.
 *
 * Pure (string in, records out) so it is unit-testable without a Codex install.
 * Only lines that actually mention codex are considered.
 */
export function parseCodexProcessLines(output: string): ActiveProcessInfo[] {
  const result: ActiveProcessInfo[] = [];
  const uuid = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
  const re = new RegExp(`\\b(?:resume|fork)\\s+(${uuid})\\b`);
  for (const line of output.split('\n')) {
    if (!/codex/i.test(line)) continue;
    const match = line.match(re);
    if (!match) continue;
    result.push({ sessionId: match[1] });
  }
  return result;
}

function refreshCodexActiveAsync(): void {
  if (codexActiveRefreshing) return;
  codexActiveRefreshing = true;
  const { cmd, args } = codexProcCommand();
  execFile(cmd, args, { encoding: 'utf-8', timeout: 5000, windowsHide: true }, (err, stdout) => {
    codexActiveRefreshing = false;
    if (err) return; // keep the previous cache on failure
    codexActiveCache = { result: parseCodexProcessLines(stdout || ''), ts: Date.now() };
  });
}
