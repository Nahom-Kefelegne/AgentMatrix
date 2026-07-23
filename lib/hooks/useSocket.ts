'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import type { SessionData, ServerToClientEvents, ClientToServerEvents } from '@/lib/types';
import { SOCKET_EVENTS } from '@/lib/types';
import { SOCKET_PATH } from '@/lib/constants';
import { perfEvent } from '@/lib/perf';

export type SocketEventHandler = {
  event: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
};

export function useSocket() {
  const [connected, setConnected] = useState(false);
  const [sessions, setSessions] = useState<Map<string, SessionData>>(new Map());
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const eventCallbacksRef = useRef<((handler: SocketEventHandler) => void)[]>([]);

  const onEvent = useCallback((cb: (handler: SocketEventHandler) => void) => {
    eventCallbacksRef.current.push(cb);
    return () => {
      eventCallbacksRef.current = eventCallbacksRef.current.filter(fn => fn !== cb);
    };
  }, []);

  const emitEvent = useCallback((event: string, data: unknown) => {
    perfEvent(`sock:${event}`);
    eventCallbacksRef.current.forEach(cb => cb({ event, data }));
  }, []);

  useEffect(() => {
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({
      path: SOCKET_PATH,
      transports: ['websocket', 'polling'],
    });

    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on(SOCKET_EVENTS.STATE_SNAPSHOT, (snapshot: SessionData[]) => {
      const map = new Map<string, SessionData>();
      snapshot.forEach(s => map.set(s.id, s));
      setSessions(map);
      emitEvent(SOCKET_EVENTS.STATE_SNAPSHOT, snapshot);
    });

    socket.on(SOCKET_EVENTS.SESSION_START, (session: SessionData) => {
      setSessions(prev => {
        const next = new Map(prev);
        next.set(session.id, session);
        return next;
      });
      emitEvent(SOCKET_EVENTS.SESSION_START, session);
    });

    socket.on(SOCKET_EVENTS.SESSION_END, (data) => {
      setSessions(prev => {
        const next = new Map(prev);
        next.delete(data.sessionId);
        return next;
      });
      emitEvent(SOCKET_EVENTS.SESSION_END, data);
    });

    socket.on(SOCKET_EVENTS.SESSION_UPDATE, (data) => {
      setSessions(prev => {
        const next = new Map(prev);
        const existing = next.get(data.sessionId);
        if (existing) {
          next.set(data.sessionId, { ...existing, ...data.changes });
        }
        return next;
      });
      emitEvent(SOCKET_EVENTS.SESSION_UPDATE, data);
    });

    socket.on(SOCKET_EVENTS.TOOL_START, (data) => {
      setSessions(prev => {
        const next = new Map(prev);
        const existing = next.get(data.sessionId);
        if (existing) {
          next.set(data.sessionId, { ...existing, currentTool: data.toolName, status: 'working' });
        }
        return next;
      });
      emitEvent(SOCKET_EVENTS.TOOL_START, data);
    });

    socket.on(SOCKET_EVENTS.TOOL_COMPLETE, (data) => {
      setSessions(prev => {
        const next = new Map(prev);
        const existing = next.get(data.sessionId);
        if (existing) {
          const action = { toolName: data.toolName, summary: data.summary, timestamp: Date.now() };
          next.set(data.sessionId, {
            ...existing,
            currentTool: undefined,
            recentActions: [action, ...existing.recentActions].slice(0, 10),
          });
        }
        return next;
      });
      emitEvent(SOCKET_EVENTS.TOOL_COMPLETE, data);
    });

    socket.on(SOCKET_EVENTS.AGENT_START, (data) => {
      setSessions(prev => {
        const next = new Map(prev);
        const existing = next.get(data.sessionId);
        if (existing) {
          next.set(data.sessionId, {
            ...existing,
            agents: [...existing.agents, data.agent],
          });
        }
        return next;
      });
      emitEvent(SOCKET_EVENTS.AGENT_START, data);
    });

    socket.on(SOCKET_EVENTS.AGENT_STOP, (data) => {
      setSessions(prev => {
        const next = new Map(prev);
        const existing = next.get(data.sessionId);
        if (existing) {
          next.set(data.sessionId, {
            ...existing,
            agents: existing.agents.filter(a => a.id !== data.agentId && a.name !== data.agentName),
          });
        }
        return next;
      });
      emitEvent(SOCKET_EVENTS.AGENT_STOP, data);
    });

    socket.on(SOCKET_EVENTS.MEETING_START, (data) => {
      emitEvent(SOCKET_EVENTS.MEETING_START, data);
    });

    socket.on(SOCKET_EVENTS.MEETING_MESSAGE, (data) => {
      emitEvent(SOCKET_EVENTS.MEETING_MESSAGE, data);
    });

    // @ts-expect-error custom event not in typed interface
    socket.on('session:fired', (data: { sessionId: string }) => {
      emitEvent('session:fired', data);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [emitEvent]);

  return { connected, sessions, onEvent, socketRef };
}
