'use client';

import { useCallback, useRef } from 'react';
import { useSocketContext } from '@/app/components/SocketProvider';

export interface OrchestratorResult {
  success: boolean;
  content: string;
  lines: string[];
}

/**
 * How long the client waits beyond the server's own budget before giving up.
 * Covers socket/IPC round-trip so the server's answer always lands first.
 */
const CLIENT_TIMEOUT_GRACE_MS = 5000;

/**
 * Hook for querying the orchestrator session.
 * Returns a `query` function that sends an instruction and returns the result.
 */
export function useOrchestrator() {
  const { socketRef } = useSocketContext();
  const pendingRef = useRef<Map<string, (result: OrchestratorResult) => void>>(new Map());
  const listenerSetRef = useRef(false);

  const ensureListener = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || listenerSetRef.current) return;
    listenerSetRef.current = true;

    socket.on('orchestrator:result' as any, (data: { queryId: string; success: boolean; content: string; lines: string[] }) => {
      const resolve = pendingRef.current.get(data.queryId);
      if (resolve) {
        pendingRef.current.delete(data.queryId);
        resolve({ success: data.success, content: data.content, lines: data.lines });
      }
    });
  }, [socketRef]);

  const query = useCallback(async (instruction: string, timeoutMs = 60000): Promise<OrchestratorResult> => {
    const socket = socketRef.current;
    if (!socket) return { success: false, content: '', lines: [] };

    ensureListener();

    const queryId = `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    return new Promise((resolve) => {
      pendingRef.current.set(queryId, resolve);
      // `timeoutMs` must cross the wire, not just arm the local timer below.
      // The server otherwise falls back to captureQuery's 45s default, so a
      // caller asking for longer (deep search asks for 120s) had its query
      // abandoned server-side at 45s while the client kept waiting — surfacing
      // as a silent empty result.
      socket.emit('orchestrator:query' as any, { query: instruction, queryId, timeoutMs });

      // Client-side safety net: fires only if the server never answers at all
      // (socket dropped, main process died). Deliberately LATER than the
      // server's own budget by CLIENT_TIMEOUT_GRACE_MS — at exactly `timeoutMs`
      // the two race, and the client can discard a real server response that
      // was already on its way.
      setTimeout(() => {
        if (pendingRef.current.has(queryId)) {
          pendingRef.current.delete(queryId);
          resolve({ success: false, content: '', lines: [] });
        }
      }, timeoutMs + CLIENT_TIMEOUT_GRACE_MS);
    });
  }, [socketRef, ensureListener]);

  return { query };
}
