'use client';

import { useCallback, useRef } from 'react';
import { useSocketContext } from '@/app/components/SocketProvider';

export interface OrchestratorResult {
  success: boolean;
  content: string;
  lines: string[];
}

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
      socket.emit('orchestrator:query' as any, { query: instruction, queryId });

      // Timeout
      setTimeout(() => {
        if (pendingRef.current.has(queryId)) {
          pendingRef.current.delete(queryId);
          resolve({ success: false, content: '', lines: [] });
        }
      }, timeoutMs);
    });
  }, [socketRef, ensureListener]);

  return { query };
}
