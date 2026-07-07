'use client';

import type { CliType } from '@/lib/types';
import TerminalPanel from './TerminalPanel';
import CopilotTerminalPanel from './CopilotTerminalPanel';

interface SessionConsoleProps {
  sessionId: string;
  sessionName: string;
  cwd?: string;
  visible?: boolean;
  readOnly?: boolean;
  cliType?: CliType;
}

/**
 * Routes a session to the right console implementation: the Copilot-native
 * passthrough panel for Copilot sessions, the legacy panel for Claude. Keyed
 * by sessionId so switching sessions cleanly remounts the terminal.
 */
export default function SessionConsole({ cliType, ...props }: SessionConsoleProps) {
  if (cliType === 'copilot') {
    return <CopilotTerminalPanel key={props.sessionId} {...props} />;
  }
  return <TerminalPanel key={props.sessionId} cliType={cliType} {...props} />;
}
