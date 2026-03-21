'use client';

import { useState, useEffect, useRef } from 'react';
import type { SessionData } from '@/lib/types';
import { useSocketContext } from './SocketProvider';
import { SOCKET_EVENTS } from '@/lib/types';

interface TickerItem {
  id: string;
  sessionName: string;
  text: string;
  timestamp: number;
}

const MAX_ITEMS = 20;

/**
 * ActivityTicker — Scrolling horizontal strip showing live session activity.
 * Listens for tool start/complete events and displays them as a ticker.
 */
export default function ActivityTicker({ sessions }: { sessions: Map<string, SessionData> }) {
  const { socketRef, connected } = useSocketContext();
  const [items, setItems] = useState<TickerItem[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !connected) return;

    const handleTool = (data: any) => {
      const session = sessions.get(data.sessionId);
      const name = session?.name || data.sessionId?.slice(0, 8) || '?';
      const text = data.summary || data.toolName || 'working';

      setItems(prev => {
        const next = [{ id: `${Date.now()}-${Math.random()}`, sessionName: name, text, timestamp: Date.now() }, ...prev];
        return next.slice(0, MAX_ITEMS);
      });
    };

    socket.on(SOCKET_EVENTS.TOOL_COMPLETE, handleTool);
    socket.on(SOCKET_EVENTS.TOOL_START, (data: any) => {
      const session = sessions.get(data.sessionId);
      const name = session?.name || data.sessionId?.slice(0, 8) || '?';
      handleTool({ ...data, sessionId: data.sessionId, summary: data.toolName ? `Using ${data.toolName}` : undefined });
    });

    return () => {
      socket.off(SOCKET_EVENTS.TOOL_COMPLETE, handleTool);
    };
  }, [socketRef, connected, sessions]);

  // Auto-prune old items (>60s)
  useEffect(() => {
    const interval = setInterval(() => {
      const cutoff = Date.now() - 60000;
      setItems(prev => prev.filter(i => i.timestamp > cutoff));
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="activity-ticker" ref={containerRef}>
      <div className="activity-ticker-track">
        {items.map(item => (
          <span key={item.id} className="activity-ticker-item">
            <span className="activity-ticker-dot" />
            <span className="activity-ticker-name">{item.sessionName}</span>
            <span className="activity-ticker-text">{item.text}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
