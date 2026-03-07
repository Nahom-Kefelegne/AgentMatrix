export type SessionState = 'busy' | 'ready' | 'needs_action';

export interface ParsedState {
  state: SessionState;
  /** What kind of action is needed (if needs_action) */
  actionType?: 'approval' | 'permission' | 'choice' | 'trust';
  /** Short description of what's needed */
  actionLabel?: string;
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

  /** Check if Claude is waiting for user input (prompt ready) */
  static isPromptReady(text: string): boolean {
    const clean = OutputParser.stripAnsi(text).trim();
    return /[>\u276F]\s*$/.test(clean);
  }

  /** Detect if Claude needs user action (approval, permission, choice) */
  static detectActionNeeded(text: string): ParsedState | null {
    const clean = OutputParser.stripAnsi(text);

    // Trust/safety prompt
    if (/Yes, I trust this folder|trust this project/i.test(clean)) {
      return { state: 'needs_action', actionType: 'trust', actionLabel: 'Trust folder confirmation needed' };
    }

    // Yes/No prompts (plan mode approval, permission)
    if (/\(y\/n\)\s*$/i.test(clean.trim())) {
      // Try to figure out what kind
      if (/approve|proceed|execute|apply/i.test(clean)) {
        return { state: 'needs_action', actionType: 'approval', actionLabel: 'Plan approval needed' };
      }
      if (/allow|permission|access/i.test(clean)) {
        return { state: 'needs_action', actionType: 'permission', actionLabel: 'Permission requested' };
      }
      return { state: 'needs_action', actionType: 'choice', actionLabel: 'Response needed' };
    }

    // "Do you want to proceed?" style prompts
    if (/do you want to (proceed|continue|apply)/i.test(clean)) {
      return { state: 'needs_action', actionType: 'approval', actionLabel: 'Approval needed' };
    }

    // Enter to confirm patterns
    if (/enter to confirm|press enter/i.test(clean.trim())) {
      return { state: 'needs_action', actionType: 'choice', actionLabel: 'Confirmation needed' };
    }

    // Selection menu (like trust prompt options)
    if (/\u276F\s*\d+\.\s/m.test(clean) || /❯\s*\d+\.\s/m.test(clean)) {
      return { state: 'needs_action', actionType: 'choice', actionLabel: 'Selection needed' };
    }

    return null;
  }

  /** Full state detection from recent output buffer */
  static detectState(recentOutput: string): ParsedState {
    // Check for action needed first (higher priority)
    const action = OutputParser.detectActionNeeded(recentOutput);
    if (action) return action;

    // Check if prompt ready
    if (OutputParser.isPromptReady(recentOutput)) {
      return { state: 'ready' };
    }

    return { state: 'busy' };
  }

  static isEcho(text: string, lastPrompt: string): boolean {
    if (!lastPrompt) return false;
    const clean = OutputParser.stripAnsi(text).trim();
    return clean === lastPrompt.trim() || clean.endsWith(lastPrompt.trim());
  }
}
