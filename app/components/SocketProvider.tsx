'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { useSocket, type SocketEventHandler } from '@/lib/hooks/useSocket';
import type { SessionData } from '@/lib/types';
import type { Socket } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents } from '@/lib/types';
import type { MutableRefObject } from 'react';

interface SocketContextValue {
  connected: boolean;
  sessions: Map<string, SessionData>;
  onEvent: (cb: (handler: SocketEventHandler) => void) => () => void;
  socketRef: MutableRefObject<Socket<ServerToClientEvents, ClientToServerEvents> | null>;
}

const SocketContext = createContext<SocketContextValue | null>(null);

export function SocketProvider({ children }: { children: ReactNode }) {
  const socketState = useSocket();

  return (
    <SocketContext.Provider value={socketState}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocketContext() {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error('useSocketContext must be used within SocketProvider');
  return ctx;
}
