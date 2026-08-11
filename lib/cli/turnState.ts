type SessionTurnEndedHandler = (sessionId: string) => void;

const globalTurnState = globalThis as typeof globalThis & {
  __agentMatrixSessionTurnEnded?: SessionTurnEndedHandler;
};

export function setSessionTurnEndedHandler(
  handler: SessionTurnEndedHandler,
): void {
  globalTurnState.__agentMatrixSessionTurnEnded = handler;
}

export function notifySessionTurnEnded(sessionId: string): void {
  globalTurnState.__agentMatrixSessionTurnEnded?.(sessionId);
}
