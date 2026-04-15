import type { CliProvider } from '../../lib/cli/CliProvider';

export type PtyState = 'busy' | 'ready';

export interface StateInfo {
  state: PtyState;
}

export class OutputParser {
  private provider?: CliProvider;

  constructor(provider?: CliProvider) {
    this.provider = provider;
  }

  static stripAnsi(text: string): string {
    return text
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
      .replace(/\x1b\][^\x07]*\x07/g, '')
      .replace(/\x1b\[\?[0-9;]*[a-zA-Z]/g, '')
      .replace(/\x1b[()][AB012]/g, '')
      .replace(/\x1b\[<[a-zA-Z]/g, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '');
  }

  /** Static version — uses default Claude prompt detection (backward compat). */
  static isPromptReady(text: string): boolean {
    const clean = OutputParser.stripAnsi(text).trim();
    return /[>\u276F]\s*$/.test(clean);
  }

  /** Instance version — delegates to provider if available. */
  isPromptReadyForProvider(text: string): boolean {
    if (this.provider) {
      return this.provider.detectPromptReady(text);
    }
    return OutputParser.isPromptReady(text);
  }

  /** Static version — uses default Claude context parsing (backward compat). */
  static parseContextUsage(text: string): number | null {
    const c = OutputParser.stripAnsi(text);
    // "Context: 97% remaining (3% used)" — words may be squished or spaced
    const remainMatch = c.match(/(\d+)%\s*remaining/i);
    if (remainMatch) return 100 - parseInt(remainMatch[1], 10);
    const usedMatch = c.match(/(\d+)%\s*used/i);
    if (usedMatch) return parseInt(usedMatch[1], 10);
    return null;
  }

  /** Instance version — delegates to provider if available. */
  parseContextUsageForProvider(text: string): number | null {
    if (this.provider) {
      return this.provider.parseContextUsage(text);
    }
    return OutputParser.parseContextUsage(text);
  }

  static isEcho(text: string, lastPrompt: string): boolean {
    if (!lastPrompt) return false;
    const clean = OutputParser.stripAnsi(text).trim();
    return clean === lastPrompt.trim() || clean.endsWith(lastPrompt.trim());
  }
}
