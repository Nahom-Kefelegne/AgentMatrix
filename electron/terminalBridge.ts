import type { Server as SocketIOServer } from 'socket.io';
import { PtyManager } from './pty/PtyManager';
import { randomUUID } from 'crypto';
import { homedir } from 'os';
import { addSession, getAllSessions, getSession, removeSession, updateSession } from '../lib/state/sessionStore';
import { setCachedName } from '../lib/state/nameCache';
import { getActiveSessions, saveActiveSessions } from '../lib/state/activeSessionsCache';
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

function createSessionEntry(id: string, name: string, cwd: string) {
  const deskIndex = getNextDeskIndex();
  const isDesk = deskIndex < DESK_POSITIONS.length;
  const deskPosition = isDesk
    ? DESK_POSITIONS[deskIndex]
    : deskIndex < DESK_POSITIONS.length + OVERFLOW_POSITIONS.length
      ? OVERFLOW_POSITIONS[deskIndex - DESK_POSITIONS.length]
      : ENTRANCE_POINT;
  const colorIndex = getAllSessions().length % CHARACTER_COLORS.length;

  return {
    id,
    name,
    color: CHARACTER_COLORS[colorIndex],
    status: 'idle' as const,
    deskIndex,
    deskPosition,
    spawnPosition: ENTRANCE_POINT,
    recentActions: [],
    agents: [],
    cwd,
    createdAt: Date.now(),
  };
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
        const sessionUuid = randomUUID();
        const name = opts.name || `session-${Date.now().toString(36)}`;
        console.log(`[terminal:new] name=${name} uuid=${sessionUuid.slice(0, 8)} cwd=${opts.cwd}`);

        const sessionData = createSessionEntry(sessionUuid, name, opts.cwd);
        addSession(sessionData);
        setCachedName(sessionUuid, name);
        io.emit(SOCKET_EVENTS.SESSION_START, sessionData);

        ptyManager.spawnNew(sessionUuid, {
          cwd: opts.cwd,
          sessionUuid,
          name: opts.name,
          permissionMode: opts.permissionMode,
          model: opts.model,
          effort: opts.effort,
          allowedTools: opts.allowedTools,
          systemPrompt: opts.systemPrompt,
        });

        ptyManager.onOutput(sessionUuid, (data) => {
          socket.emit('terminal:data', { sessionId: sessionUuid, data });
        });

        // Wire up callbacks
        const newPty = ptyManager.getSession(sessionUuid);
        if (newPty) {
          newPty.onStateChange = (info) => {
            io.emit('session:state', { sessionId: sessionUuid, ...info });
          };
          newPty.onContextUpdate = (usage) => {
            io.emit('session:context', { sessionId: sessionUuid, usage });
          };
        }

        // Track for auto-resume
        const active = getActiveSessions().filter(s => s.id !== sessionUuid);
        active.push({ id: sessionUuid, name, cwd: opts.cwd });
        saveActiveSessions(active);

        socket.emit('terminal:spawned', { sessionId: sessionUuid, name });
      } catch (err) {
        console.error('[terminal:new]', err);
      }
    });

    // Resume a past session by ID
    socket.on('terminal:resume', ({ sessionId }: { sessionId: string }) => {
      try {
        if (ptyManager.hasPty(sessionId)) {
          ptyManager.onOutput(sessionId, (data) => {
            socket.emit('terminal:data', { sessionId, data });
          });
          // Ensure callbacks are set (might be missing from auto-resume)
          const existingPty = ptyManager.getSession(sessionId);
          if (existingPty) {
            if (!existingPty.onStateChange) {
              existingPty.onStateChange = (info) => io.emit('session:state', { sessionId, ...info });
            }
            if (!existingPty.onContextUpdate) {
              existingPty.onContextUpdate = (usage) => {
                io.emit('session:context', { sessionId, usage });
              };
            }
          }
          return;
        }

        const { getCachedName: getName } = require('../lib/state/nameCache');
        const existing = getSession(sessionId);
        const name = existing?.name || getName(sessionId) || `Session-${sessionId.slice(0, 8)}`;
        const cwd = existing?.cwd || ptyManager.findSessionCwd(sessionId) || homedir();

        // Create session entry so sprite appears
        if (!existing) {
          const sessionData = createSessionEntry(sessionId, name, cwd);
          addSession(sessionData);
          io.emit(SOCKET_EVENTS.SESSION_START, sessionData);
        }

        console.log(`[terminal:resume] ${name} (${sessionId.slice(0, 8)})`);

        // Track for auto-resume
        const active = getActiveSessions().filter(s => s.id !== sessionId);
        active.push({ id: sessionId, name, cwd });
        saveActiveSessions(active);

        ptyManager.spawnResume(sessionId, { cwd, resumeId: sessionId });

        ptyManager.onOutput(sessionId, (data) => {
          socket.emit('terminal:data', { sessionId, data });
        });

        const rPty = ptyManager.getSession(sessionId);
        if (rPty) {
          rPty.onStateChange = (info) => {
            io.emit('session:state', { sessionId, ...info });
          };
          rPty.onContextUpdate = (usage) => {
            io.emit('session:context', { sessionId, usage });
          };
        }
      } catch (err) {
        console.error('[terminal:resume]', err);
      }
    });

    // End a session — fire animation, then /exit, then cleanup
    socket.on('terminal:end', ({ sessionId }: { sessionId: string }) => {
      try {
        // Remove from auto-resume list
        saveActiveSessions(getActiveSessions().filter(s => s.id !== sessionId));

        // Trigger fired animation FIRST
        io.emit('session:fired', { sessionId });

        // Send /exit to PTY after a small delay (let animation start)
        setTimeout(() => {
          if (ptyManager.hasPty(sessionId)) {
            const ptySession = ptyManager.getSession(sessionId);
            if (ptySession) ptySession.pty.write('/exit\r');
          }
        }, 500);

        // Clean up after animation finishes
        setTimeout(() => {
          ptyManager.kill(sessionId);
          removeSession(sessionId);
          io.emit(SOCKET_EVENTS.SESSION_END, { sessionId });
        }, 8000); // shocked(1s) + packing(1.5s) + walk to exit(~4s) + buffer
      } catch (err) {
        console.error('[terminal:end]', err);
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
