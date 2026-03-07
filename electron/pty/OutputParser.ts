export class OutputParser {
  /**
   * Strip ANSI escape codes for clean text display.
   */
  static stripAnsi(text: string): string {
    return text
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
      .replace(/\x1b\][^\x07]*\x07/g, '')
      .replace(/\x1b\[\?[0-9;]*[a-zA-Z]/g, '')
      .replace(/\x1b[()][AB012]/g, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '');
  }

  /**
   * Check if Claude is waiting for user input.
   * Claude Code shows various prompt indicators when ready.
   */
  static isPromptReady(text: string): boolean {
    const clean = OutputParser.stripAnsi(text).trim();
    // Claude Code prompt patterns:
    // ❯  (unicode right-pointing angle)
    // >  (simple angle bracket)
    // Also matches after initial startup message
    if (/[>\u276F]\s*$/.test(clean)) return true;
    // "waiting for your input" or similar idle indicators
    if (/\(y\/n\)\s*$/i.test(clean)) return true;
    return false;
  }

  /**
   * Check if text looks like an echo of a prompt we just sent.
   */
  static isEcho(text: string, lastPrompt: string): boolean {
    if (!lastPrompt) return false;
    const clean = OutputParser.stripAnsi(text).trim();
    // PTY echo: the exact prompt text appears in output
    return clean === lastPrompt.trim() || clean.endsWith(lastPrompt.trim());
  }
}
