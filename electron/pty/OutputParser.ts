export type PtyState = 'busy' | 'ready';

export interface StateInfo {
  state: PtyState;
}

export class OutputParser {
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

  static isPromptReady(text: string): boolean {
    const clean = OutputParser.stripAnsi(text).trim();
    return /[>\u276F]\s*$/.test(clean);
  }

  /** Parse context usage from Claude's status bar output. Returns % used or null. */
  static parseContextUsage(text: string): number | null {
    const c = OutputParser.stripAnsi(text);
    // "Context: 97% remaining (3% used)" — words may be squished or spaced
    const remainMatch = c.match(/(\d+)%\s*remaining/i);
    if (remainMatch) return 100 - parseInt(remainMatch[1], 10);
    const usedMatch = c.match(/(\d+)%\s*used/i);
    if (usedMatch) return parseInt(usedMatch[1], 10);
    return null;
  }

  static isEcho(text: string, lastPrompt: string): boolean {
    if (!lastPrompt) return false;
    const clean = OutputParser.stripAnsi(text).trim();
    return clean === lastPrompt.trim() || clean.endsWith(lastPrompt.trim());
  }
}
