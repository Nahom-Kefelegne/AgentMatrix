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

export interface ActivityInfo {
  toolName: string;
  toolSummary: string;
}

/**
 * usePrompt — sends prompts via a separate --print mode process (not the Console PTY).
 * This gives clean structured output without terminal noise.
 *
 * The Prompt tab and Console tab are independent:
 * - Prompt: uses `prompt:send` → server spawns `claude --print --resume <id>` → clean text back
 * - Console: uses `terminal:spawn` → raw interactive PTY
 */
export function usePrompt(
  socketRef: React.RefObject<Socket<ServerToClientEvents, ClientToServerEvents> | null>,
  sessionId: string | null,
) {
  const [messages, setMessages] = useState<PromptMessage[]>([]);
  const [isWaiting, setIsWaiting] = useState(false);
  const [isReady, setIsReady] = useState(true); // Prompt tab is always "ready" (uses --print)
  const [activity, setActivity] = useState<ActivityInfo | null>(null);
  const bufferRef = useRef('');

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !sessionId) return;

    // Receive streamed response chunks from --print mode
    const handleOutput = (data: { sessionId: string; text: string }) => {
      if (data.sessionId !== sessionId) return;
      bufferRef.current += data.text;
      // Update streaming message
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant') {
          const updated = [...prev];
          updated[updated.length - 1] = { ...last, text: bufferRef.current };
          return updated;
        }
        return [...prev, { role: 'assistant', text: bufferRef.current, timestamp: Date.now() }];
      });
    };

    // Response complete
    const handleReady = (data: { sessionId: string }) => {
      if (data.sessionId !== sessionId) return;
      setIsWaiting(false);
      setIsReady(true);
      setActivity(null);
      bufferRef.current = '';
    };

    const handleError = (data: { sessionId: string; error: string }) => {
      if (data.sessionId !== sessionId) return;
      setIsWaiting(false);
      setMessages(prev => [
        ...prev,
        { role: 'assistant', text: `Error: ${data.error}`, timestamp: Date.now() },
      ]);
      bufferRef.current = '';
    };

    // Tool events for activity indicator
    const handleToolStart = (data: { sessionId: string; toolName: string; toolInput?: string }) => {
      if (!isWaiting) return;
      let summary = data.toolName;
      if (data.toolInput) {
        try {
          const input = JSON.parse(data.toolInput);
          if (input.file_path) summary = `${data.toolName} ${input.file_path}`;
          else if (input.command) summary = `${data.toolName} ${String(input.command).slice(0, 60)}`;
          else if (input.pattern) summary = `${data.toolName} ${input.pattern}`;
        } catch {}
      }
      setActivity({ toolName: data.toolName, toolSummary: summary });
    };

    const handleToolComplete = () => {
      if (!isWaiting) return;
      setActivity(null);
    };

    socket.on(SOCKET_EVENTS.PROMPT_OUTPUT as 'prompt:output', handleOutput);
    socket.on(SOCKET_EVENTS.PROMPT_READY as 'prompt:ready', handleReady);
    socket.on(SOCKET_EVENTS.PROMPT_ERROR as 'prompt:error', handleError);
    socket.on(SOCKET_EVENTS.TOOL_START as any, handleToolStart);
    socket.on(SOCKET_EVENTS.TOOL_COMPLETE as any, handleToolComplete);

    return () => {
      socket.off(SOCKET_EVENTS.PROMPT_OUTPUT as 'prompt:output', handleOutput);
      socket.off(SOCKET_EVENTS.PROMPT_READY as 'prompt:ready', handleReady);
      socket.off(SOCKET_EVENTS.PROMPT_ERROR as 'prompt:error', handleError);
      socket.off(SOCKET_EVENTS.TOOL_START as any, handleToolStart);
      socket.off(SOCKET_EVENTS.TOOL_COMPLETE as any, handleToolComplete);
    };
  }, [socketRef, sessionId, isWaiting]);

  const sendPrompt = useCallback(
    (prompt: string) => {
      const socket = socketRef.current;
      if (!socket || !sessionId) return;

      setMessages(prev => [...prev, { role: 'user', text: prompt, timestamp: Date.now() }]);
      setIsWaiting(true);
      setIsReady(false);
      setActivity(null);
      bufferRef.current = '';

      // Send via prompt:send — server handles it with --print mode
      socket.emit(SOCKET_EVENTS.PROMPT_SEND as 'prompt:send', { sessionId, prompt });
    },
    [socketRef, sessionId],
  );

  const stopWaiting = useCallback(() => {
    setIsWaiting(false);
    setActivity(null);
    bufferRef.current = '';
  }, []);

  const clear = useCallback(() => {
    setMessages([]);
    setIsWaiting(false);
    setIsReady(true);
    setActivity(null);
    bufferRef.current = '';
  }, []);

  return { messages, setMessages, sendPrompt, isWaiting, isReady, activity, clear, stopWaiting };
}
