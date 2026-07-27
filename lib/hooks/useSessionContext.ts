'use client';

import { useState, useEffect } from 'react';
import type { Socket } from 'socket.io-client';

export function useSessionContext(
  socketRef: React.RefObject<Socket | null>,
  connected: boolean,
): Record<string, number> {
  const [contexts, setContexts] = useState<Record<string, number>>({});

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !connected) return;
    const controller = new AbortController();

    const handler = (data: { sessionId: string; usage: number }) => {
      setContexts(prev => {
        if (prev[data.sessionId] === data.usage) return prev;
        return { ...prev, [data.sessionId]: data.usage };
      });
    };

    socket.on('session:context' as any, handler);
    fetch('/api/sessions/context', { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(`Context request failed (${response.status})`);
        return response.json() as Promise<{ contexts?: Record<string, number> }>;
      })
      .then(data => {
        if (!data.contexts) return;
        setContexts(previous => ({ ...previous, ...data.contexts }));
      })
      .catch(error => {
        if (!controller.signal.aborted) console.error('[session-context]', error);
      });

    return () => {
      controller.abort();
      socket.off('session:context' as any, handler);
    };
  }, [socketRef, connected]);

  return contexts;
}
