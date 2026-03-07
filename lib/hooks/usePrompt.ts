'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { Socket } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents } from '@/lib/types';
import { SOCKET_EVENTS } from '@/lib/types';

export interface PromptMessage {
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
}

export function usePrompt(
  socketRef: React.RefObject<Socket<ServerToClientEvents, ClientToServerEvents> | null>,
  sessionId: string | null,
) {
  const [messages, setMessages] = useState<PromptMessage[]>([]);
  const [isWaiting, setIsWaiting] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const bufferRef = useRef('');

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !sessionId) return;

    const handleOutput = (data: { sessionId: string; text: string }) => {
      if (data.sessionId !== sessionId) return;

      bufferRef.current += data.text;

      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === 'assistant') {
          const updated = [...prev];
          updated[updated.length - 1] = { ...last, text: bufferRef.current };
          return updated;
        }
        return [...prev, { role: 'assistant', text: bufferRef.current, timestamp: Date.now() }];
      });
    };

    const handleReady = (data: { sessionId: string }) => {
      if (data.sessionId !== sessionId) return;
      setIsWaiting(false);
      setIsReady(true);
      bufferRef.current = '';
    };

    const handleError = (data: { sessionId: string; error: string }) => {
      if (data.sessionId !== sessionId) return;
      setIsWaiting(false);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: `Error: ${data.error}`, timestamp: Date.now() },
      ]);
    };

    socket.on(SOCKET_EVENTS.PROMPT_OUTPUT as 'prompt:output', handleOutput);
    socket.on(SOCKET_EVENTS.PROMPT_READY as 'prompt:ready', handleReady);
    socket.on(SOCKET_EVENTS.PROMPT_ERROR as 'prompt:error', handleError);

    return () => {
      socket.off(SOCKET_EVENTS.PROMPT_OUTPUT as 'prompt:output', handleOutput);
      socket.off(SOCKET_EVENTS.PROMPT_READY as 'prompt:ready', handleReady);
      socket.off(SOCKET_EVENTS.PROMPT_ERROR as 'prompt:error', handleError);
    };
  }, [socketRef, sessionId]);

  const sendPrompt = useCallback(
    (prompt: string) => {
      const socket = socketRef.current;
      if (!socket || !sessionId) return;

      setMessages((prev) => [...prev, { role: 'user', text: prompt, timestamp: Date.now() }]);
      setIsWaiting(true);
      setIsReady(false);
      bufferRef.current = '';

      socket.emit(SOCKET_EVENTS.PROMPT_SEND as 'prompt:send', { sessionId, prompt });
    },
    [socketRef, sessionId],
  );

  const clear = useCallback(() => {
    setMessages([]);
    setIsWaiting(false);
    setIsReady(false);
    bufferRef.current = '';
  }, []);

  return { messages, setMessages, sendPrompt, isWaiting, isReady, clear };
}
