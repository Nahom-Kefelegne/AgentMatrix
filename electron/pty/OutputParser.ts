export class OutputParser {
  /**
   * Strip ANSI escape codes for clean text display.
   */
  static stripAnsi(text: string): string {
    return text
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
      .replace(/\x1b\][^\x07]*\x07/g, '')
      .replace(/\x1b\[[\?]?[0-9;]*[a-zA-Z]/g, '')
      .replace(/\r/g, '');
  }

  /**
   * Check if Claude is waiting for user input.
   * Claude Code shows a prompt character when ready for the next command.
   */
  static isPromptReady(text: string): boolean {
    const clean = OutputParser.stripAnsi(text);
    return /[>\u276F]\s*$/.test(clean.trim());
  }
}
