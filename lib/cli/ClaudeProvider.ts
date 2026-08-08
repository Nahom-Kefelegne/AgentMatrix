import { execSync, execFile, execFileSync } from 'child_process';
import { existsSync, readdirSync, statSync, openSync, readSync, closeSync, appendFileSync } from 'fs';
import { open } from 'fs/promises';
import { join, sep } from 'path';
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
import { CLAUDE_MODELS, CLAUDE_PERMISSION_MODES } from './uiMetadata';
import { pickSpawnableBinary } from './binaryPath';

/**
 * Strip ANSI escape codes from terminal output.
 * Duplicated here so the provider is self-contained (no circular deps with OutputParser).
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

/** Official Claude sparkle logo (from claude.ai/favicon.svg) */
const CLAUDE_ICON_SVG = `<svg width="16" height="16" viewBox="0 0 248 248" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M52.4285 162.873L98.7844 136.879L99.5485 134.602L98.7844 133.334H96.4921L88.7237 132.862L62.2346 132.153L39.3113 131.207L17.0249 130.026L11.4214 128.844L6.2 121.873L6.7094 118.447L11.4214 115.257L18.171 115.847L33.0711 116.911L55.485 118.447L71.6586 119.392L95.728 121.873H99.5485L100.058 120.337L98.7844 119.392L97.7656 118.447L74.5877 102.732L49.4995 86.1905L36.3823 76.62L29.3779 71.7757L25.8121 67.2858L24.2839 57.3608L30.6515 50.2716L39.3113 50.8623L41.4763 51.4531L50.2636 58.1879L68.9842 72.7209L93.4357 90.6804L97.0015 93.6343L98.4374 92.6652L98.6571 91.9801L97.0015 89.2625L83.757 65.2772L69.621 40.8192L63.2534 30.6579L61.5978 24.632C60.9565 22.1032 60.579 20.0111 60.579 17.4246L67.8381 7.49965L71.9133 6.19995L81.7193 7.49965L85.7946 11.0443L91.9074 24.9865L101.714 46.8451L116.996 76.62L121.453 85.4816L123.873 93.6343L124.764 96.1155H126.292V94.6976L127.566 77.9197L129.858 57.3608L132.15 30.8942L132.915 23.4505L136.608 14.4708L143.994 9.62643L149.725 12.344L154.437 19.0788L153.8 23.4505L150.998 41.6463L145.522 70.1215L141.957 89.2625H143.994L146.414 86.7813L156.093 74.0206L172.266 53.698L179.398 45.6635L187.803 36.802L193.152 32.5484H203.34L210.726 43.6549L207.415 55.1159L196.972 68.3492L188.312 79.5739L175.896 96.2095L168.191 109.585L168.882 110.689L170.738 110.53L198.755 104.504L213.91 101.787L231.994 98.7149L240.144 102.496L241.036 106.395L237.852 114.311L218.495 119.037L195.826 123.645L162.07 131.592L161.696 131.893L162.137 132.547L177.36 133.925L183.855 134.279H199.774L229.447 136.524L237.215 141.605L241.8 147.867L241.036 152.711L229.065 158.737L213.019 154.956L175.45 145.977L162.587 142.787H160.805V143.85L171.502 154.366L191.242 172.089L215.82 195.011L217.094 200.682L213.91 205.172L210.599 204.699L188.949 188.394L180.544 181.069L161.696 165.118H160.422V166.772L164.752 173.152L187.803 207.771L188.949 218.405L187.294 221.832L181.308 223.959L174.813 222.777L161.187 203.754L147.305 182.486L136.098 163.345L134.745 164.2L128.075 235.42L125.019 239.082L117.887 241.8L111.902 237.31L108.718 229.984L111.902 215.452L115.722 196.547L118.779 181.541L121.58 162.873L123.291 156.636L123.14 156.219L121.773 156.449L107.699 175.752L86.304 204.699L69.3663 222.777L65.291 224.431L58.2867 220.768L58.9235 214.27L62.8713 208.48L86.304 178.705L100.44 160.155L109.551 149.507L109.462 147.967L108.959 147.924L46.6977 188.512L35.6182 189.93L30.7788 185.44L31.4156 178.115L33.7079 175.752L52.4285 162.873Z" fill="currentColor"/>
</svg>`;

const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects');

const TRUST_PROMPT_PATTERNS = [
  'trust this folder',
  'trust this project',
  'Is this a project',
  'Yes, I trust',
];

const CONTEXT_PROMPT_PATTERNS = [
  'conversation is getting long',
  'context is large',
  'continue as-is',
  'start fresh',
  'compact',
  'summarize the conversation',
];

// ─── Context-window accounting ───────────────────────────────────────
//
// Claude records per-turn token accounting in its own transcript, which is a
// far more stable source than scraping the TUI status line (see
// parseContextUsage). Everything below is pure and exported so the arithmetic
// can be unit-tested without touching the filesystem.

/**
 * Context-window size (tokens) per model. APPROXIMATE — Anthropic doesn't
 * publish these in a machine-readable form the CLI exposes, so these are the
 * documented/observed sizes and must be revisited as models ship.
 *
 * 200k is the long-standing default for the Claude line. LONG_CONTEXT is for
 * the models that clearly exceed it: the values in CLAUDE_LONG_CONTEXT_MODELS
 * were each observed in real transcripts on this machine consuming well past
 * 200k tokens in a single turn (e.g. claude-opus-4-8 at 768,448 and
 * claude-fable-5 at 390,762), which is only possible with a ~1M window.
 *
 * An under-sized guess degrades gracefully rather than breaking: the
 * percentage is clamped to 99, so an unknown large-context model reads as
 * "nearly full" instead of throwing or reporting a nonsense >100 value.
 */
const CLAUDE_DEFAULT_CONTEXT_WINDOW = 200_000;
const CLAUDE_LONG_CONTEXT_WINDOW = 1_000_000;

/**
 * Substrings of `message.model` known to carry the ~1M window. Matched as
 * substrings so dated variants (e.g. "claude-opus-4-8-20260115") resolve too.
 */
const CLAUDE_LONG_CONTEXT_MODELS = [
  'opus-4-8',
  'opus-5',
  'sonnet-5',
  'fable-5',
  'haiku-5',
];

/**
 * Map a transcript `message.model` id to its assumed context window.
 * Mirrors CopilotProvider's contextWindowForModel: one named default plus a
 * small, documented override table. Unknown/empty models get the default.
 */
export function contextWindowForModel(model: string): number {
  const normalized = (model || '').toLowerCase();
  if (!normalized) return CLAUDE_DEFAULT_CONTEXT_WINDOW;
  // Explicit "[1m]" suffix is how the 1M-context beta is tagged.
  if (normalized.includes('[1m]')) return CLAUDE_LONG_CONTEXT_WINDOW;
  for (const known of CLAUDE_LONG_CONTEXT_MODELS) {
    if (normalized.includes(known)) return CLAUDE_LONG_CONTEXT_WINDOW;
  }
  return CLAUDE_DEFAULT_CONTEXT_WINDOW;
}

/** The token counts a transcript turn reports. All fields are optional. */
export interface ClaudeTokenUsage {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
}

/** The subset of a transcript `"type":"assistant"` line we care about. */
export interface ClaudeAssistantEntry {
  type?: string;
  /** True for subagent turns, which have their own separate context. */
  isSidechain?: boolean;
  message?: {
    model?: string;
    usage?: ClaudeTokenUsage;
  };
}

/**
 * Tokens currently occupying the context window for a turn.
 *
 * input_tokens + cache_creation_input_tokens + cache_read_input_tokens.
 * `output_tokens` is deliberately EXCLUDED — it's what the model produced,
 * not what was resident in the window when the request was made. Verified
 * against a real transcript: 133 + 1112 + 360788 = 362033.
 *
 * Non-numeric / missing fields count as 0 so a partially-populated usage
 * object still yields a usable total.
 */
export function sumContextTokens(usage: ClaudeTokenUsage | null | undefined): number {
  if (!usage || typeof usage !== 'object') return 0;
  const part = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
  return (
    part(usage.input_tokens) +
    part(usage.cache_creation_input_tokens) +
    part(usage.cache_read_input_tokens)
  );
}

/**
 * Whether an entry represents real main-session context usage.
 *
 * Rejects:
 *  - non-assistant lines (user, attachment, ai-title, ...),
 *  - `isSidechain: true` subagent turns — they have their own context window
 *    and would otherwise clobber the main session's reading,
 *  - the `<synthetic>` model, which Claude writes for locally-injected error
 *    placeholders (e.g. "Failed to authenticate: OAuth session expired") with
 *    an all-zero usage block. Observed in real transcripts; without this an
 *    errored session reports 0%.
 *  - anything summing to zero tokens.
 */
export function isUsableUsageEntry(entry: ClaudeAssistantEntry | null | undefined): boolean {
  if (!entry || typeof entry !== 'object') return false;
  if (entry.type !== 'assistant') return false;
  if (entry.isSidechain === true) return false;
  const model = entry.message?.model || '';
  if (model === '<synthetic>') return false;
  return sumContextTokens(entry.message?.usage) > 0;
}

/**
 * Pick the entry that reflects the session's current context fill: the LAST
 * usable one in file order. Takes already-parsed entries so it stays pure.
 * Returns null when nothing qualifies.
 */
export function selectLatestUsageEntry(
  entries: Array<ClaudeAssistantEntry | null | undefined> | null | undefined,
): ClaudeAssistantEntry | null {
  if (!Array.isArray(entries)) return null;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (isUsableUsageEntry(entry)) return entry as ClaudeAssistantEntry;
  }
  return null;
}

/**
 * Scan a raw chunk of JSONL (a tail of a transcript) BACKWARDS and return the
 * first usable usage entry found — i.e. the most recent one.
 *
 * Parsing backwards with an early return means we JSON.parse only a handful of
 * lines instead of the whole chunk, which matters because transcripts run to
 * multiple MB and JSON.parse is synchronous. The chunk's first line is usually
 * truncated (the tail starts at an arbitrary byte offset); it simply fails to
 * parse and is skipped.
 */
export function findLatestUsageEntryInTail(chunk: string | null | undefined): ClaudeAssistantEntry | null {
  if (!chunk || typeof chunk !== 'string') return null;
  const lines = chunk.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line || line.charCodeAt(0) !== 123 /* '{' */) continue;
    // Cheap pre-filter: skip the (large) user/attachment lines without paying
    // for a full JSON.parse of them.
    if (!line.includes('"usage"')) continue;
    let parsed: ClaudeAssistantEntry;
    try {
      parsed = JSON.parse(line) as ClaudeAssistantEntry;
    } catch {
      continue;
    }
    if (isUsableUsageEntry(parsed)) return parsed;
  }
  return null;
}

/**
 * Turn a usage entry into an integer percentage of its model's context window.
 * Clamped to 0-99 (mirrors CopilotProvider) so a rough estimate never claims a
 * full or over-full window. Returns null when the entry carries no usable
 * token count.
 */
export function contextPercentFromEntry(
  entry: ClaudeAssistantEntry | null | undefined,
): number | null {
  const tokens = sumContextTokens(entry?.message?.usage);
  if (tokens <= 0) return null;
  const window = contextWindowForModel(entry?.message?.model || '');
  const pct = Math.round((tokens / window) * 100);
  return Math.max(0, Math.min(99, pct));
}

/**
 * The last `custom-title` value in a chunk of transcript JSONL, or null.
 * Scans backwards because the newest title wins (see renameSession).
 */
export function findLastCustomTitleInTail(chunk: string | null | undefined): string | null {
  if (!chunk || typeof chunk !== 'string') return null;
  const lines = chunk.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line || !line.includes('"custom-title"')) continue;
    try {
      const parsed = JSON.parse(line) as { type?: string; customTitle?: string };
      if (parsed.type === 'custom-title' && typeof parsed.customTitle === 'string') {
        return parsed.customTitle;
      }
    } catch {
      continue;
    }
  }
  return null;
}

/** Initial tail read. Comfortably covers the last turn of a normal session. */
const CONTEXT_TAIL_BYTES = 256 * 1024;
/** One widened retry for sessions whose final turn carries huge tool output. */
const CONTEXT_TAIL_BYTES_WIDE = 2 * 1024 * 1024;

/**
 * Read the last `maxBytes` of a file asynchronously. Returns the text plus
 * whether the read was truncated (i.e. the file is bigger than the window),
 * so the caller knows whether widening could help. Never throws.
 */
async function readTailAsync(
  path: string,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean } | null> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(path, 'r');
    const { size } = await handle.stat();
    if (size <= 0) return null;
    const length = Math.min(maxBytes, size);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    return { text: buffer.toString('utf-8'), truncated: length < size };
  } catch {
    return null;
  } finally {
    if (handle) await handle.close().catch(() => { /* ignore */ });
  }
}

/** UUID v4 pattern. Guards writes so we only ever touch a real session file. */
const CLAUDE_SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Bounded tail read used by renameSession's idempotence check. */
const RENAME_TAIL_BYTES = 64 * 1024;

/** Synchronous bounded tail read. Returns null on any failure. */
function readTailSync(path: string, maxBytes: number): string | null {
  let fd: number | null = null;
  try {
    const size = statSync(path).size;
    if (size <= 0) return null;
    const length = Math.min(maxBytes, size);
    fd = openSync(path, 'r');
    const buffer = Buffer.alloc(length);
    const read = readSync(fd, buffer, 0, length, size - length);
    return buffer.toString('utf-8', 0, read);
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/**
 * Whether the file's final byte is a newline. Used to confirm the transcript
 * has no partially-written trailing line before we append to it.
 */
function endsWithNewlineSync(path: string): boolean {
  let fd: number | null = null;
  try {
    const size = statSync(path).size;
    if (size <= 0) return false;
    fd = openSync(path, 'r');
    const buffer = Buffer.alloc(1);
    const read = readSync(fd, buffer, 0, 1, size - 1);
    return read === 1 && buffer[0] === 0x0a;
  } catch {
    return false;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/**
 * Read the first ~4KB of a file. Used to extract the JSON header line
 * from large transcript files without loading the whole thing.
 */
function readFirstBytes(path: string, bytes = 4000): string {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    readSync(fd, buf, 0, bytes, 0);
    return buf.toString('utf-8');
  } finally {
    closeSync(fd);
  }
}

/**
 * Decode an encoded Claude project directory name (e.g.
 * "-Users-foo-projects-my-app") back into an absolute path. Hyphens are
 * ambiguous (they may be path separators or part of a filename), so we
 * greedily attach segments while filesystem lookups still succeed.
 */
function decodeClaudeProjectDirName(encoded: string): string | null {
  // Windows: leading "-" followed by a single uppercase letter is the drive letter.
  // Example: "-Q-src-teams-modular" → "Q:\src\teams-modular".
  const isWin = process.platform === 'win32';
  let segments = encoded.split('-');
  let path = '';
  let i = 0;

  if (isWin && segments.length > 0 && /^[A-Za-z]$/.test(segments[0])) {
    path = segments[0].toUpperCase() + ':';
    i = 1;
  }

  while (i < segments.length) {
    let found = false;
    for (let end = segments.length; end > i; end--) {
      const joined = segments.slice(i, end).join('-');
      const candidate = path
        ? path + sep + joined
        : isWin ? joined : '/' + joined;
      if (existsSync(candidate)) {
        path = candidate;
        i = end;
        found = true;
        break;
      }
    }
    if (!found) {
      path = path
        ? path + sep + segments[i]
        : isWin ? segments[i] : '/' + segments[i];
      i++;
    }
  }
  return existsSync(path) ? path : null;
}

export class ClaudeProvider implements CliProvider {
  readonly type: CliType = 'claude';
  readonly configDir = join(homedir(), '.claude');
  readonly displayName = 'Claude Code';
  readonly iconSvg = CLAUDE_ICON_SVG;
  readonly iconColor = '#D97757';

  readonly supportsMcp = true;
  readonly supportsFork = true;
  readonly supportsContextTracking = true;
  readonly supportsSubagents = true;
  readonly supportsAcp = false;

  findBinary(): string {
    try {
      const cmd = process.platform === 'win32' ? 'where claude' : 'which claude';
      const output = execSync(cmd, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const result = pickSpawnableBinary(output.trim().split(/\r?\n/));
      if (result) return result;
    } catch { /* ignore */ }

    const home = homedir();
    const candidates = process.platform === 'win32'
      // Extensionless npm shims are POSIX shell scripts; CreateProcess rejects
      // them with error 193, so Windows only ever lists executable extensions.
      ? [
          join(home, '.local', 'bin', 'claude.exe'),
          join(home, 'AppData', 'Local', 'Programs', 'claude', 'claude.exe'),
          join(home, 'AppData', 'Roaming', 'npm', 'claude.cmd'),
          'C:\\Program Files\\Claude\\claude.exe',
        ]
      : [
          '/usr/local/bin/claude',
          join(home, '.local', 'bin', 'claude'),
          join(home, '.npm-global', 'bin', 'claude'),
        ];

    for (const p of candidates) {
      if (existsSync(p)) return p;
    }

    throw new Error('Claude CLI not found. Install it or add it to PATH.');
  }

  checkHealth(): CliHealth {
    try {
      const binaryPath = this.findBinary();
      const version = execSync(`"${binaryPath}" --version`, {
        encoding: 'utf-8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      return { type: 'claude', installed: true, version, binaryPath };
    } catch {
      let binaryPath: string | null = null;
      try { binaryPath = this.findBinary(); } catch { /* not found */ }

      return {
        type: 'claude',
        installed: false,
        version: null,
        binaryPath,
        error: binaryPath
          ? `Binary found at ${binaryPath} but version check failed`
          : 'Claude CLI not found. Install it or add it to PATH.',
      };
    }
  }

  buildSpawnArgs(opts: SpawnOptions): string[] {
    const args: string[] = [];
    if (opts.sessionId) args.push('--session-id', opts.sessionId);
    if (opts.permissionMode === 'bypassPermissions') {
      args.push('--dangerously-skip-permissions');
    } else if (opts.permissionMode) {
      args.push('--permission-mode', opts.permissionMode);
    }
    if (opts.model) args.push('--model', opts.model);
    if (opts.effort) args.push('--effort', opts.effort);
    if (opts.allowedTools) args.push('--allowedTools', opts.allowedTools);
    if (opts.systemPrompt) {
      // Collapse to a single line; shell-quoting happens uniformly at spawn.
      const oneLine = opts.systemPrompt.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
      args.push('--append-system-prompt', oneLine);
    }
    return args;
  }

  buildResumeArgs(opts: ResumeOptions): string[] {
    const args = ['--resume', opts.resumeId];
    if (opts.permissionMode === 'bypassPermissions') {
      args.push('--dangerously-skip-permissions');
    } else if (opts.permissionMode) {
      args.push('--permission-mode', opts.permissionMode);
    }
    if (opts.model) args.push('--model', opts.model);
    if (opts.effort) args.push('--effort', opts.effort);
    if (opts.allowedTools) args.push('--allowedTools', opts.allowedTools);
    if (opts.fork) args.push('--fork-session');
    return args;
  }

  buildResumeShellCommand(opts: ResumeOptions): string {
    const args = this.buildResumeArgs(opts);
    return `claude ${args.join(' ')}`;
  }

  getExitSequence(): Array<{ data: string; delayMs: number }> {
    // Claude's TUI exits on the `/exit` slash-command + Enter.
    return [{ data: '/exit\r', delayMs: 0 }];
  }

  detectPromptReady(text: string): boolean {
    const clean = stripAnsi(text).trim();
    return /[>❯]\s*$/.test(clean);
  }

  parseContextUsage(text: string): number | null {
    const c = stripAnsi(text);
    const remainMatch = c.match(/(\d+)%\s*remaining/i);
    if (remainMatch) return 100 - parseInt(remainMatch[1], 10);
    const usedMatch = c.match(/(\d+)%\s*used/i);
    if (usedMatch) return parseInt(usedMatch[1], 10);
    return null;
  }

  /**
   * Context-window usage (% used, 0-99) read from Claude's own per-turn token
   * accounting in the session transcript, rather than scraped from the TUI.
   *
   * Each `"type":"assistant"` line carries `message.usage`; the tokens resident
   * in the window are input_tokens + cache_creation_input_tokens +
   * cache_read_input_tokens (see sumContextTokens). The LAST non-sidechain
   * entry is the session's current fill level.
   *
   * This is the more reliable of the two sources — `parseContextUsage` depends
   * on the exact wording of Claude Code's status line and breaks whenever that
   * changes, whereas the transcript schema is the CLI's own persisted record.
   * Both remain available; callers may prefer this and fall back to the parser.
   *
   * Transcripts reach multiple MB, so we read a bounded 256KB tail and parse it
   * backwards, stopping at the first usable entry — typically only a few
   * JSON.parse calls. If the tail contains no usage entry (a final turn with
   * very large tool output) we widen once to 2MB, then give up. All file I/O is
   * async so Electron's main thread is never blocked.
   *
   * Returns null when the transcript can't be found or carries no usable usage.
   */
  async getContextUsage(sessionId: string): Promise<number | null> {
    const transcriptPath = this.getTranscriptPath(sessionId);
    if (!transcriptPath) return null;

    for (const bytes of [CONTEXT_TAIL_BYTES, CONTEXT_TAIL_BYTES_WIDE]) {
      const tail = await readTailAsync(transcriptPath, bytes);
      if (!tail) return null;
      const entry = findLatestUsageEntryInTail(tail.text);
      if (entry) return contextPercentFromEntry(entry);
      // Already read the whole file — widening cannot surface anything new.
      if (!tail.truncated) break;
    }
    return null;
  }

  getTrustPromptPatterns(): string[] { return TRUST_PROMPT_PATTERNS; }
  getContextPromptPatterns(): string[] { return CONTEXT_PROMPT_PATTERNS; }
  getModelList() { return CLAUDE_MODELS; }
  getPermissionModes(): PermissionMode[] { return CLAUDE_PERMISSION_MODES; }

  /**
   * COST: O(N) directory scans + N small file reads. Call from UI flows
   * only (Resume modal, deep search). Do NOT call from render hot paths.
   */
  discoverSessions(): DiscoveredSession[] {
    // Short-TTL cache: this scans every Claude project dir (readdir + per-file
    // reads) which is slow on network drives and is hit by the resume modal and
    // the periodic scanner. Caching keeps repeat opens instant and bounds how
    // often the sync scan can block the event loop.
    const now = Date.now();
    if (claudeDiscoverCache && now - claudeDiscoverCache.ts < CLAUDE_DISCOVER_TTL_MS) {
      return claudeDiscoverCache.sessions;
    }
    const sessions = this.discoverSessionsUncached();
    claudeDiscoverCache = { sessions, ts: now };
    return sessions;
  }

  private discoverSessionsUncached(): DiscoveredSession[] {
    if (!existsSync(CLAUDE_PROJECTS_DIR)) return [];
    const results: DiscoveredSession[] = [];

    let projectDirs: string[];
    try {
      projectDirs = readdirSync(CLAUDE_PROJECTS_DIR);
    } catch {
      return [];
    }

    for (const dir of projectDirs) {
      const dirPath = join(CLAUDE_PROJECTS_DIR, dir);
      let entries: string[];
      try {
        if (!statSync(dirPath).isDirectory()) continue;
        entries = readdirSync(dirPath);
      } catch {
        continue;
      }

      for (const file of entries) {
        if (!file.endsWith('.jsonl')) continue;
        const id = file.slice(0, -6);  // strip ".jsonl"
        const transcriptPath = join(dirPath, file);
        let cwd: string | undefined;
        let lastModified: number | undefined;

        try {
          lastModified = statSync(transcriptPath).mtimeMs;
          const head = readFirstBytes(transcriptPath, 3000);
          const firstLine = head.split('\n')[0];
          if (firstLine) {
            const parsed = JSON.parse(firstLine);
            if (parsed.cwd) cwd = parsed.cwd;
          }
        } catch { /* ignore — keep partial data */ }

        if (!cwd) {
          const decoded = decodeClaudeProjectDirName(dir.replace(/^-/, ''));
          if (decoded) cwd = decoded;
        }

        results.push({ id, cwd, transcriptPath, lastModified });
      }
    }

    return results;
  }

  /**
   * COST: O(N) directory scans where N = number of Claude project dirs.
   * Reads only the first 4KB of the transcript file.
   */
  findSessionCwd(sessionId: string): string | undefined {
    if (!existsSync(CLAUDE_PROJECTS_DIR)) return undefined;

    let transcriptPath: string | undefined;
    let projectDirName: string | undefined;
    let dirs: string[];
    try {
      dirs = readdirSync(CLAUDE_PROJECTS_DIR);
    } catch {
      return undefined;
    }

    for (const dir of dirs) {
      const dirPath = join(CLAUDE_PROJECTS_DIR, dir);
      try {
        if (!statSync(dirPath).isDirectory()) continue;
        const candidate = join(dirPath, `${sessionId}.jsonl`);
        if (existsSync(candidate)) {
          transcriptPath = candidate;
          projectDirName = dir;
          break;
        }
      } catch { /* skip */ }
    }
    if (!transcriptPath || !projectDirName) return undefined;

    try {
      const head = readFirstBytes(transcriptPath, 4000);
      const firstLine = head.split('\n')[0];
      const parsed = JSON.parse(firstLine);
      if (parsed.cwd && existsSync(parsed.cwd)) return parsed.cwd;
    } catch { /* fall through */ }

    const decoded = decodeClaudeProjectDirName(projectDirName.replace(/^-/, ''));
    return decoded || undefined;
  }

  /**
   * Claude stores each session transcript at projects/<project>/<id>.jsonl.
   * The project dir isn't known from the id alone, so scan for the file.
   * COST: O(N) project-dir scans; cheap existsSync per dir.
   */
  getTranscriptPath(sessionId: string): string | undefined {
    if (!existsSync(CLAUDE_PROJECTS_DIR)) return undefined;
    let dirs: string[];
    try {
      dirs = readdirSync(CLAUDE_PROJECTS_DIR);
    } catch {
      return undefined;
    }
    for (const dir of dirs) {
      const candidate = join(CLAUDE_PROJECTS_DIR, dir, `${sessionId}.jsonl`);
      if (existsSync(candidate)) return candidate;
    }
    return undefined;
  }

  /**
   * Persist a session title in Claude's own on-disk store by appending a
   * `custom-title` record to the session transcript.
   *
   * VERIFIED against real transcripts in ~/.claude/projects:
   *  - The record is exactly `{"type":"custom-title","customTitle":"...",
   *    "sessionId":"..."}` — three keys, observed identically across four
   *    separate sessions. There is no separate title index or metadata file
   *    anywhere under ~/.claude, so the transcript is the authoritative store.
   *  - It is a SIDECAR line: unlike user/assistant lines it carries no `uuid`,
   *    `parentUuid` or `timestamp`, so it sits outside the conversation DAG.
   *    Appending one therefore cannot corrupt message replay.
   *  - Newest-wins. Claude re-appends the current title on each checkpoint
   *    (54-87 copies in long sessions). The sibling `ai-title` record was
   *    observed CHANGING within a single file ("Update configuration settings"
   *    → "Update config"), which is only coherent if the reader takes the last
   *    occurrence.
   *
   * SAFETY: append-only — the file is never rewritten or truncated, so a
   * multi-MB transcript can't be lost. We refuse to write unless the file
   * already ends in a newline, so we can never concatenate onto (and corrupt)
   * a partially-written trailing line.
   *
   * CAVEAT: a currently-running Claude process may re-append its own in-memory
   * title at its next checkpoint, superseding this write. The rename is
   * therefore reliable for idle//resumed sessions and best-effort for live
   * ones. The app's own name cache (see app/api/sessions/rename/route.ts, which
   * writes setCachedName + setActiveSessionName regardless of this return
   * value) is what drives the AgentMatrix UI either way; this write is what
   * makes the name visible OUTSIDE AgentMatrix.
   */
  renameSession(sessionId: string, newName: string): boolean {
    const name = newName.trim();
    if (!name) return false;
    if (!CLAUDE_SESSION_ID_RE.test(sessionId)) return false;

    const transcriptPath = this.getTranscriptPath(sessionId);
    if (!transcriptPath) return false;

    try {
      // Already the current title — skip the redundant append.
      const tail = readTailSync(transcriptPath, RENAME_TAIL_BYTES);
      if (tail !== null && findLastCustomTitleInTail(tail) === name) return true;

      // Only append to a file in a known-good state. A missing trailing
      // newline means the last line is partial (live writer mid-flush, or a
      // truncated file); appending would corrupt it.
      if (!endsWithNewlineSync(transcriptPath)) return false;

      const record = JSON.stringify({
        type: 'custom-title',
        customTitle: name,
        sessionId,
      });
      appendFileSync(transcriptPath, `${record}\n`, 'utf-8');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * COST: spawns a `ps` subprocess (~5-50ms). Called periodically by
   * the session scanner; not in render paths.
   */
  detectActiveSessionIds(): ActiveProcessInfo[] {
    const now = Date.now();
    if (claudeActiveCache) {
      if (now - claudeActiveCache.ts >= CLAUDE_ACTIVE_TTL_MS) refreshClaudeActiveAsync();
      return claudeActiveCache.result;
    }
    // Cold start: one synchronous read to seed the cache (typically the startup
    // scan), then every later call is served from cache + refreshed in the
    // background so a resume-modal open never blocks on wmic/ps.
    const { cmd, args } = claudeProcCommand();
    try {
      const output = execFileSync(cmd, args, { encoding: 'utf-8', timeout: 5000, windowsHide: true });
      claudeActiveCache = { result: parseClaudeProcessLines(output), ts: now };
    } catch {
      claudeActiveCache = { result: [], ts: now };
    }
    return claudeActiveCache.result;
  }
}

// Detecting live Claude sessions runs a slow subprocess (wmic on Windows, ps on
// Unix) that blocked the shared event loop on every resume-modal open / scan.
// Cache the result and refresh it asynchronously (see detectActiveSessionIds).
const CLAUDE_ACTIVE_TTL_MS = 4000;
let claudeActiveCache: { result: ActiveProcessInfo[]; ts: number } | null = null;
let claudeActiveRefreshing = false;

// Short-TTL cache for the project-dir scan (see discoverSessions).
const CLAUDE_DISCOVER_TTL_MS = 4000;
let claudeDiscoverCache: { sessions: DiscoveredSession[]; ts: number } | null = null;

function claudeProcCommand(): { cmd: string; args: string[] } {
  if (process.platform === 'win32') {
    return {
      cmd: 'wmic',
      args: ['process', 'where', "name='claude.exe' or name='node.exe'", 'get', 'CommandLine', '/format:csv'],
    };
  }
  return { cmd: '/bin/sh', args: ['-c', "ps -eo args | grep '[c]laude' | grep -- '--session-id'"] };
}

function refreshClaudeActiveAsync(): void {
  if (claudeActiveRefreshing) return;
  claudeActiveRefreshing = true;
  const { cmd, args } = claudeProcCommand();
  execFile(cmd, args, { encoding: 'utf-8', timeout: 5000, windowsHide: true }, (err, stdout) => {
    claudeActiveRefreshing = false;
    if (err) return; // keep previous cache on failure
    claudeActiveCache = { result: parseClaudeProcessLines(stdout || ''), ts: Date.now() };
  });
}

function parseClaudeProcessLines(output: string): ActiveProcessInfo[] {
  const result: ActiveProcessInfo[] = [];
  for (const line of output.split('\n')) {
    const sessionMatch = line.match(/--session-id\s+([a-f0-9-]+)/);
    if (!sessionMatch) continue;
    const resumeMatch = line.match(/--resume\s+(\S+)/);
    result.push({
      sessionId: sessionMatch[1],
      resumeName: resumeMatch ? resumeMatch[1] : undefined,
    });
  }
  return result;
}
