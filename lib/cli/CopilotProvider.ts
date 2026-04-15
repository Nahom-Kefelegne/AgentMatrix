import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { CliProvider, CliHealth, SpawnOptions, ResumeOptions, CliType } from './CliProvider';

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

/** GitHub Copilot sparkle/wing icon as inline SVG */
const COPILOT_ICON_SVG = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M8 1C8 1 6.5 4 4 5.5C1.5 7 1 8 1 8C1 8 3 8.5 4 10C5 11.5 5.5 15 5.5 15C5.5 15 7 11 8 9.5C9 11 10.5 15 10.5 15C10.5 15 11 11.5 12 10C13 8.5 15 8 15 8C15 8 14.5 7 12 5.5C9.5 4 8 1 8 1Z" fill="currentColor"/>
</svg>`;

export class CopilotProvider implements CliProvider {
  readonly type: CliType = 'copilot';
  readonly configDir = join(homedir(), '.copilot');
  readonly displayName = 'GitHub Copilot';
  readonly iconSvg = COPILOT_ICON_SVG;
  readonly iconColor = '#2F81F7';

  findBinary(): string {
    // Try PATH first
    try {
      const cmd = process.platform === 'win32' ? 'where copilot' : 'which copilot';
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
      if (existsSync(p)) {
        return p;
      }
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
      return {
        type: 'copilot',
        installed: true,
        version,
        binaryPath,
      };
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
    if (opts.permissionMode === 'bypassPermissions') {
      args.push('--yolo');
    }
    if (opts.model) args.push('--model', opts.model);
    if (opts.effort) args.push('--reasoning-effort', opts.effort);
    if (opts.cwd) args.push('--cwd', opts.cwd);
    return args;
  }

  buildResumeArgs(opts: ResumeOptions): string[] {
    const args = ['--resume', opts.resumeId];
    // Copilot remembers permission state on resume, no --yolo needed
    // No --fork-session equivalent
    return args;
  }

  detectPromptReady(text: string): boolean {
    const clean = stripAnsi(text).trim();
    // Broader pattern for Copilot's various prompt indicators
    return /[$\u276F\u203A>]\s*$/.test(clean);
  }

  parseContextUsage(text: string): number | null {
    // Copilot context usage format is unknown — return null for now
    return null;
  }

  getModelList(): Array<{ value: string; label: string }> {
    return [
      { value: '', label: 'Default' },
      { value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
      { value: 'gpt-5', label: 'GPT-5' },
      { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
      { value: 'gemini-3-pro', label: 'Gemini 3 Pro' },
    ];
  }
}
