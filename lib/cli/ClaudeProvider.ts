import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { CliProvider, CliHealth, SpawnOptions, ResumeOptions, CliType } from './CliProvider';

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

export class ClaudeProvider implements CliProvider {
  readonly type: CliType = 'claude';
  readonly configDir = join(homedir(), '.claude');
  readonly displayName = 'Claude Code';
  readonly iconSvg = CLAUDE_ICON_SVG;
  readonly iconColor = '#D97757';

  findBinary(): string {
    // Try PATH first
    try {
      const cmd = process.platform === 'win32' ? 'where claude' : 'which claude';
      const result = execSync(cmd, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim().split(/\r?\n/)[0].trim();
      if (result) return result;
    } catch { /* ignore */ }

    // Fallback: check common install locations
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
      if (existsSync(p)) {
        return p;
      }
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
      return {
        type: 'claude',
        installed: true,
        version,
        binaryPath,
      };
    } catch (err) {
      // Check if binary was found but version command failed
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
      // Flatten to single line to avoid shell escaping issues
      const oneLine = opts.systemPrompt.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
      const escaped = oneLine.replace(/'/g, "'\\''");
      args.push('--append-system-prompt', `'${escaped}'`);
    }
    return args;
  }

  buildResumeArgs(opts: ResumeOptions): string[] {
    const args = ['--resume', opts.resumeId, '--dangerously-skip-permissions'];
    if (opts.fork) args.push('--fork-session');
    return args;
  }

  detectPromptReady(text: string): boolean {
    const clean = stripAnsi(text).trim();
    return /[>\u276F]\s*$/.test(clean);
  }

  parseContextUsage(text: string): number | null {
    const c = stripAnsi(text);
    const remainMatch = c.match(/(\d+)%\s*remaining/i);
    if (remainMatch) return 100 - parseInt(remainMatch[1], 10);
    const usedMatch = c.match(/(\d+)%\s*used/i);
    if (usedMatch) return parseInt(usedMatch[1], 10);
    return null;
  }

  getModelList(): Array<{ value: string; label: string }> {
    return [
      { value: '', label: 'Default' },
      { value: 'opus', label: 'Opus (Latest)' },
      { value: 'sonnet', label: 'Sonnet (Latest)' },
      { value: 'haiku', label: 'Haiku (Latest)' },
      { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
      { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    ];
  }
}
