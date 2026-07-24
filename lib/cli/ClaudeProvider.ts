import { execSync, execFile, execFileSync } from 'child_process';
import { existsSync, readdirSync, statSync, openSync, readSync, closeSync } from 'fs';
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
      const result = execSync(cmd, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim().split(/\r?\n/)[0].trim();
      if (result) return result;
    } catch { /* ignore */ }

    const home = homedir();
    const candidates = process.platform === 'win32'
      ? [
          join(home, '.local', 'bin', 'claude.exe'),
          join(home, '.local', 'bin', 'claude'),
          join(home, 'AppData', 'Local', 'Programs', 'claude', 'claude.exe'),
          join(home, 'AppData', 'Roaming', 'npm', 'claude.cmd'),
          join(home, 'AppData', 'Roaming', 'npm', 'claude'),
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
    const args = ['--resume', opts.resumeId, '--dangerously-skip-permissions'];
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
   * Claude prints context usage in its TUI, so usage comes from
   * `parseContextUsage` on the output stream, not from disk. No-op here.
   */
  async getContextUsage(_sessionId: string): Promise<number | null> {
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
   * No-op at the disk level. Claude renames happen in-TUI via the `/rename`
   * command (injected into the PTY by the client); the name is recorded in the
   * transcript and picked up by the scanner. There's no separate metadata file
   * to write, so we return false to signal "not handled here".
   */
  renameSession(_sessionId: string, _newName: string): boolean {
    return false;
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
