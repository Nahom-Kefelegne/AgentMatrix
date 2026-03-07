import type { Server as SocketIOServer } from 'socket.io';
import { PtyManager } from './pty/PtyManager';
import { getSession } from '../lib/state/sessionStore';

/**
 * Bridge for terminal I/O between xterm.js and PTY sessions.
 * Handles: spawning new sessions, resuming existing ones, raw I/O, resize.
 */
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
        // Generate a temporary ID for the PTY (scanner will pick up the real session)
        const tempId = `new-${Date.now()}`;
        console.log(`[terminal:new] cwd=${opts.cwd} name=${opts.name || '(none)'}`);

        const ptySession = ptyManager.spawnNew(tempId, {
          cwd: opts.cwd,
          name: opts.name,
          permissionMode: opts.permissionMode,
          model: opts.model,
          effort: opts.effort,
          allowedTools: opts.allowedTools,
          systemPrompt: opts.systemPrompt,
        });

        // Stream output
        ptyManager.onOutput(tempId, (data) => {
          socket.emit('terminal:data', { sessionId: tempId, data });
        });

        socket.emit('terminal:spawned', { sessionId: tempId });
      } catch (err) {
        console.error('[terminal:new]', err);
        socket.emit('terminal:exit', { sessionId: 'new', exitCode: -1 });
      }
    });

    // Resume an existing session (no fork — continues the same session)
    socket.on('terminal:resume', ({ sessionId }: { sessionId: string }) => {
      try {
        const session = getSession(sessionId);
        const name = session?.name || sessionId;

        // If PTY already exists, re-attach
        if (ptyManager.hasPty(sessionId)) {
          console.log(`[terminal:resume] Re-attaching to ${name}`);
          ptyManager.onOutput(sessionId, (data) => {
            socket.emit('terminal:data', { sessionId, data });
          });
          return;
        }

        console.log(`[terminal:resume] Resuming ${name} (no fork)`);
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

    // Legacy: spawn with fork (kept for backward compat, used by Console tab on active sessions)
    socket.on('terminal:spawn', ({ sessionId }: { sessionId: string }) => {
      try {
        const session = getSession(sessionId);
        if (!session) {
          socket.emit('terminal:exit', { sessionId, exitCode: -1 });
          return;
        }

        if (ptyManager.hasPty(sessionId)) {
          ptyManager.onOutput(sessionId, (data) => {
            socket.emit('terminal:data', { sessionId, data });
          });
          return;
        }

        console.log(`[terminal:spawn] Forking ${session.name}`);
        ptyManager.spawnResume(sessionId, {
          cwd: session.cwd,
          resumeId: sessionId,
          fork: true,
        });

        ptyManager.onOutput(sessionId, (data) => {
          socket.emit('terminal:data', { sessionId, data });
        });
      } catch (err) {
        console.error('[terminal:spawn]', err);
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
