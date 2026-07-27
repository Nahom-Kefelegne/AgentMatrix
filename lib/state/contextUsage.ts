import { getProvider } from '../cli';
import { emitToClients } from './socketEmitter';
import { getSession, updateSession } from './sessionStore';

const inFlight = new Map<string, Promise<number | null>>();

export function refreshSessionContextUsage(sessionId: string): Promise<number | null> {
  const existing = inFlight.get(sessionId);
  if (existing) return existing;

  const request = (async () => {
    const session = getSession(sessionId);
    if (!session) return null;

    const usage = await getProvider(session.cliType || 'claude').getContextUsage(sessionId);
    if (usage === null) return null;

    if (session.contextUsage !== usage) {
      updateSession(sessionId, { contextUsage: usage });
    }
    emitToClients('session:context', { sessionId, usage });
    return usage;
  })().finally(() => {
    inFlight.delete(sessionId);
  });

  inFlight.set(sessionId, request);
  return request;
}
