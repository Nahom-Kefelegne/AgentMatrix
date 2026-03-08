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

    const handler = (data: { sessionId: string; usage: number }) => {
      setContexts(prev => {
        if (prev[data.sessionId] === data.usage) return prev;
        return { ...prev, [data.sessionId]: data.usage };
      });
    };

    socket.on('session:context' as any, handler);
    return () => { socket.off('session:context' as any, handler); };
  }, [socketRef, connected]);

  return contexts;
}
