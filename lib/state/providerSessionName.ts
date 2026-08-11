import { getProvider } from '../cli';
import { emitToClients } from './socketEmitter';
import { getSession, updateSession } from './sessionStore';
import { setCachedName } from './nameCache';
import { setActiveSessionName } from './activeSessionsCache';
import { SOCKET_EVENTS } from '../types';

export function getCopilotSessionName(sessionId: string): string | undefined {
  try {
    return getProvider('copilot').findSessionName(sessionId);
  } catch {
    return undefined;
  }
}

export function reconcileCopilotSessionName(sessionId: string): string | undefined {
  const session = getSession(sessionId);
  if (!session || session.cliType !== 'copilot') return undefined;
  const providerName = getCopilotSessionName(sessionId);
  if (!providerName || providerName === session.name) return providerName;

  updateSession(sessionId, { name: providerName });
  setCachedName(sessionId, providerName);
  setActiveSessionName(sessionId, providerName);
  emitToClients(SOCKET_EVENTS.SESSION_UPDATE, {
    sessionId,
    changes: { name: providerName },
  });
  return providerName;
}
