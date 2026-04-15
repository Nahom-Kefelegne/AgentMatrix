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

/** Official GitHub Copilot icon (from primer/octicons, MIT licensed) */
const COPILOT_ICON_SVG = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M7.998 15.035c-4.562 0-7.873-2.914-7.998-3.749V9.338c.085-.628.677-1.686 1.588-2.065.013-.07.024-.143.036-.218.029-.183.06-.384.126-.612-.201-.508-.254-1.084-.254-1.656 0-.87.128-1.769.693-2.484.579-.733 1.494-1.124 2.724-1.261 1.206-.134 2.262.034 2.944.765.05.053.096.108.139.165.044-.057.094-.112.143-.165.682-.731 1.738-.899 2.944-.765 1.23.137 2.145.528 2.724 1.261.566.715.693 1.614.693 2.484 0 .572-.053 1.148-.254 1.656.066.228.098.429.126.612.012.076.024.148.037.218.924.385 1.522 1.471 1.591 2.095v1.872c0 .766-3.351 3.795-8.002 3.795Zm0-1.485c2.28 0 4.584-1.11 5.002-1.433V7.862l-.023-.116c-.49.21-1.075.291-1.727.291-1.146 0-2.059-.327-2.71-.991A3.222 3.222 0 0 1 8 6.303a3.24 3.24 0 0 1-.544.743c-.65.664-1.563.991-2.71.991-.652 0-1.236-.081-1.727-.291l-.023.116v4.255c.419.323 2.722 1.433 5.002 1.433ZM6.762 2.83c-.193-.206-.637-.413-1.682-.297-1.019.113-1.479.404-1.713.7-.247.312-.369.789-.369 1.554 0 .793.129 1.171.308 1.371.162.181.519.379 1.442.379.853 0 1.339-.235 1.638-.54.315-.322.527-.827.617-1.553.117-.935-.037-1.395-.241-1.614Zm4.155-.297c-1.044-.116-1.488.091-1.681.297-.204.219-.359.679-.242 1.614.091.726.303 1.231.618 1.553.299.305.784.54 1.638.54.922 0 1.28-.198 1.442-.379.179-.2.308-.578.308-1.371 0-.765-.123-1.242-.37-1.554-.233-.296-.693-.587-1.713-.7Z"/>
  <path d="M6.25 9.037a.75.75 0 0 1 .75.75v1.501a.75.75 0 0 1-1.5 0V9.787a.75.75 0 0 1 .75-.75Zm4.25.75v1.501a.75.75 0 0 1-1.5 0V9.787a.75.75 0 0 1 1.5 0Z"/>
</svg>`;

export class CopilotProvider implements CliProvider {
  readonly type: CliType = 'copilot';
  readonly configDir = join(homedir(), '.copilot');
  readonly displayName = 'GitHub Copilot';
  readonly iconSvg = COPILOT_ICON_SVG;
  readonly iconColor = '#6E40C9';

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
