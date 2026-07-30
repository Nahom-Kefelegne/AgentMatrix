export type TerminalMouseProtocol = '1000' | '1002' | '1003' | null;

export interface TerminalProtocolState {
  alternateScreen: boolean;
  bracketedPaste: boolean;
  mouseProtocol: TerminalMouseProtocol;
  sgrMouseEncoding: boolean;
  mouseModeRevision: number;
  scanTail: string;
}

const ALT_SCREEN_MODES = new Set(['47', '1047', '1049']);
const MOUSE_PROTOCOL_MODES = new Set(['1000', '1002', '1003']);
const SCAN_TAIL_LENGTH = 64;

export function createTerminalProtocolState(): TerminalProtocolState {
  return {
    alternateScreen: false,
    bracketedPaste: false,
    mouseProtocol: null,
    sgrMouseEncoding: false,
    mouseModeRevision: 0,
    scanTail: '',
  };
}

/**
 * Track the persistent terminal modes a late-attaching emulator must restore.
 * Chunks may split a CSI sequence, so retain a short tail for the next scan.
 */
export function updateTerminalProtocolState(
  previous: TerminalProtocolState,
  chunk: string,
): TerminalProtocolState {
  let alternateScreen = previous.alternateScreen;
  let bracketedPaste = previous.bracketedPaste;
  let mouseProtocol = previous.mouseProtocol;
  let sgrMouseEncoding = previous.sgrMouseEncoding;
  let mouseModeRevision = previous.mouseModeRevision;
  const input = previous.scanTail + chunk;
  const previousTailLength = previous.scanTail.length;
  const modes = /\x1b\[\?([0-9;]+)([hl])/g;
  let match: RegExpExecArray | null;

  while ((match = modes.exec(input)) !== null) {
    if (match.index + match[0].length <= previousTailLength) continue;
    const enabled = match[2] === 'h';
    for (const parameter of match[1].split(';')) {
      if (ALT_SCREEN_MODES.has(parameter)) {
        alternateScreen = enabled;
      } else if (parameter === '2004') {
        bracketedPaste = enabled;
      } else if (MOUSE_PROTOCOL_MODES.has(parameter)) {
        mouseProtocol = enabled ? parameter as TerminalMouseProtocol : null;
        mouseModeRevision += 1;
      } else if (parameter === '1006') {
        sgrMouseEncoding = enabled;
        mouseModeRevision += 1;
      }
    }
  }

  return {
    alternateScreen,
    bracketedPaste,
    mouseProtocol,
    sgrMouseEncoding,
    mouseModeRevision,
    scanTail: input.slice(-SCAN_TAIL_LENGTH),
  };
}

export function isTerminalMouseTrackingActive(state: TerminalProtocolState): boolean {
  return state.mouseProtocol !== null;
}

/**
 * Recreate mode state in a new xterm attached to an already-running PTY.
 * This is renderer-only replay; the sequences are never written back to the app.
 */
export function terminalProtocolReplaySequence(state: TerminalProtocolState): string {
  let sequence = '';
  if (state.alternateScreen) sequence += '\x1b[?1049h';
  if (state.bracketedPaste) sequence += '\x1b[?2004h';
  if (state.mouseProtocol) sequence += `\x1b[?${state.mouseProtocol}h`;
  if (state.sgrMouseEncoding) sequence += '\x1b[?1006h';
  return sequence;
}
