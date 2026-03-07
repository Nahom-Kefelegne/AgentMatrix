import type { Server as SocketIOServer } from 'socket.io';
import { PtyManager } from './pty/PtyManager';
import { getSession, addSession, getAllSessions } from '../lib/state/sessionStore';
import { setCachedName } from '../lib/state/nameCache';
import { SOCKET_EVENTS } from '../lib/types';
import {
  DESK_POSITIONS, OVERFLOW_POSITIONS, ENTRANCE_POINT, CHARACTER_COLORS,
} from '../lib/constants';

function getNextDeskIndex(): number {
  const sessions = getAllSessions();
  const usedIndices = new Set(sessions.map(s => s.deskIndex));
  for (let i = 0; i < DESK_POSITIONS.length + OVERFLOW_POSITIONS.length; i++) {
    if (!usedIndices.has(i)) return i;
  }
  return sessions.length;
}

export function setupTerminalBridge(io: SocketIOServer, ptyManager: PtyManager): void {
  io.on('connection', (socket) => {

    // Launch a brand new Claude session
    socket.on('terminal:new', (opts: {
      cwd: string;
      name?: string;
      permissionMode?: string;
      model?: string;
      effort?: string;
      allowedTools?: string;
      systemPrompt?: string;
    }) => {
      try {
        const tempId = `new-${Date.now()}`;
        const name = opts.name || `session-${Date.now().toString(36)}`;
        console.log(`[terminal:new] name=${name} cwd=${opts.cwd}`);

        // Create session entry immediately so sprite appears
        const deskIndex = getNextDeskIndex();
        const isDesk = deskIndex < DESK_POSITIONS.length;
        const deskPosition = isDesk
          ? DESK_POSITIONS[deskIndex]
          : deskIndex < DESK_POSITIONS.length + OVERFLOW_POSITIONS.length
            ? OVERFLOW_POSITIONS[deskIndex - DESK_POSITIONS.length]
            : ENTRANCE_POINT;
        const colorIndex = getAllSessions().length % CHARACTER_COLORS.length;

        const sessionData = {
          id: tempId,
          name,
          color: CHARACTER_COLORS[colorIndex],
          status: 'idle' as const,
          deskIndex,
          deskPosition,
          spawnPosition: ENTRANCE_POINT,
          recentActions: [],
          agents: [],
          cwd: opts.cwd,
          createdAt: Date.now(),
        };

        addSession(sessionData);
        setCachedName(tempId, name);
        io.emit(SOCKET_EVENTS.SESSION_START, sessionData);

        // Spawn the PTY
        ptyManager.spawnNew(tempId, {
          cwd: opts.cwd,
          name: opts.name,
          permissionMode: opts.permissionMode,
          model: opts.model,
          effort: opts.effort,
          allowedTools: opts.allowedTools,
          systemPrompt: opts.systemPrompt,
        });

        ptyManager.onOutput(tempId, (data) => {
          socket.emit('terminal:data', { sessionId: tempId, data });
        });

        socket.emit('terminal:spawned', { sessionId: tempId, name });
      } catch (err) {
        console.error('[terminal:new]', err);
        socket.emit('terminal:exit', { sessionId: 'new', exitCode: -1 });
      }
    });

    // Resume an existing session (no fork)
    socket.on('terminal:resume', ({ sessionId }: { sessionId: string }) => {
      try {
        const session = getSession(sessionId);
        const name = session?.name || sessionId;

        if (ptyManager.hasPty(sessionId)) {
          console.log(`[terminal:resume] Re-attaching to ${name}`);
          ptyManager.onOutput(sessionId, (data) => {
            socket.emit('terminal:data', { sessionId, data });
          });
          return;
        }

        console.log(`[terminal:resume] Resuming ${name}`);
        ptyManager.spawnResume(sessionId, {
          cwd: session?.cwd,
          resumeId: sessionId,
        });

        ptyManager.onOutput(sessionId, (data) => {
          socket.emit('terminal:data', { sessionId, data });
        });
      } catch (err) {
        console.error('[terminal:resume]', err);
        socket.emit('terminal:exit', { sessionId, exitCode: -1 });
      }
    });

    // Forward keystrokes
    socket.on('terminal:input', ({ sessionId, data }: { sessionId: string; data: string }) => {
      const ptySession = ptyManager.getSession(sessionId);
      if (ptySession && ptySession.status !== 'closed') {
        ptySession.pty.write(data);
      }
    });

    // Handle resize
    socket.on('terminal:resize', ({ sessionId, cols, rows }: { sessionId: string; cols: number; rows: number }) => {
      const ptySession = ptyManager.getSession(sessionId);
      if (ptySession && ptySession.status !== 'closed') {
        ptySession.pty.resize(cols, rows);
      }
    });
  });
}
