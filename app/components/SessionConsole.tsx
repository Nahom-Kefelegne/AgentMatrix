'use client';

import { memo } from 'react';
import type { CliType } from '@/lib/types';
import type { NavigationRequest } from '@/lib/navigation/types';
import TerminalPanel from './TerminalPanel';
import CopilotTerminalPanel from './CopilotTerminalPanel';

interface SessionConsoleProps {
  sessionId: string;
  sessionName: string;
  cwd?: string;
  visible?: boolean;
  readOnly?: boolean;
  cliType?: CliType;
  onNavigate?: (request: NavigationRequest) => void;
}

/**
 * Routes a session to the right console implementation: the Copilot-native
 * passthrough panel for Copilot sessions, the legacy panel for Claude. Keyed
 * by sessionId so switching sessions cleanly remounts the terminal.
 *
 * Wrapped in React.memo: SessionDialog re-renders frequently (session/context
 * socket events), but the console's props (ids, cwd, visible, readOnly) are
 * stable during streaming — so memo skips reconciling the expensive xterm
 * subtree on every unrelated dialog re-render.
 */
function SessionConsole({ cliType, ...props }: SessionConsoleProps) {
  if (cliType === 'copilot') {
    return <CopilotTerminalPanel key={props.sessionId} {...props} />;
  }
  return <TerminalPanel key={props.sessionId} cliType={cliType} {...props} />;
}

export default memo(SessionConsole);
