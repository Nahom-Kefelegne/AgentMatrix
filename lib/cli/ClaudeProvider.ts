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

/** Anthropic / Claude diamond logo as inline SVG */
const CLAUDE_ICON_SVG = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M8 1L14.5 8L8 15L1.5 8L8 1Z" fill="currentColor" stroke="currentColor" stroke-width="0.5"/>
</svg>`;

export class ClaudeProvider implements CliProvider {
  readonly type: CliType = 'claude';
  readonly configDir = join(homedir(), '.claude');
  readonly displayName = 'Claude Code';
  readonly iconSvg = CLAUDE_ICON_SVG;
  readonly iconColor = '#D97706';

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
