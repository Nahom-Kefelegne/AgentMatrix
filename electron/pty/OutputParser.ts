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

  static isEcho(text: string, lastPrompt: string): boolean {
    if (!lastPrompt) return false;
    const clean = OutputParser.stripAnsi(text).trim();
    return clean === lastPrompt.trim() || clean.endsWith(lastPrompt.trim());
  }
}
