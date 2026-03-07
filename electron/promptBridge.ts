import type { Server as SocketIOServer } from 'socket.io';
import { PtyManager } from './pty/PtyManager';
import { OutputParser } from './pty/OutputParser';
import { getSession } from '../lib/state/sessionStore';

export function setupPromptBridge(io: SocketIOServer, ptyManager: PtyManager): void {
  io.on('connection', (socket) => {
    socket.on('prompt:send', ({ sessionId, prompt }) => {
      try {
        const session = getSession(sessionId);
        if (!session) {
          socket.emit('prompt:error', { sessionId, error: 'Session not found' });
          return;
        }

        // Spawn PTY if needed, using session's cwd and name
        if (!ptyManager.hasPty(sessionId)) {
          ptyManager.spawn(sessionId, {
            cwd: session.cwd,
            resumeName: session.name,
          });

          // Subscribe to output -- strip ANSI, emit to all clients
          ptyManager.onOutput(sessionId, (data) => {
            const clean = OutputParser.stripAnsi(data);
            if (clean.trim()) {
              io.emit('prompt:output', { sessionId, text: clean });
            }
          });

          // Notify when Claude is ready for input
          ptyManager.onReady(sessionId, () => {
            io.emit('prompt:ready', { sessionId });
          });
        }

        ptyManager.sendPrompt(sessionId, prompt);
      } catch (err) {
        socket.emit('prompt:error', { sessionId, error: String(err) });
      }
    });
  });
}
