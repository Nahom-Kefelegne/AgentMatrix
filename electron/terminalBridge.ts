import type { Server as SocketIOServer } from 'socket.io';
import { PtyManager } from './pty/PtyManager';
import { getSession } from '../lib/state/sessionStore';

/**
 * Bridge for raw terminal I/O between xterm.js in the browser and PTY sessions.
 * Unlike promptBridge (which strips ANSI and parses output), this passes raw data.
 */
export function setupTerminalBridge(io: SocketIOServer, ptyManager: PtyManager): void {
  io.on('connection', (socket) => {
    // Spawn a PTY for a session and start streaming raw data
    socket.on('terminal:spawn', ({ sessionId }) => {
      try {
        const session = getSession(sessionId);
        if (!session) {
          socket.emit('terminal:exit', { sessionId, exitCode: -1 });
          return;
        }

        // If PTY already exists, just re-subscribe this socket
        if (ptyManager.hasPty(sessionId)) {
          console.log(`[terminal] Re-attaching to existing PTY for ${session.name}`);
          ptyManager.onOutput(sessionId, (data) => {
            socket.emit('terminal:data', { sessionId, data });
          });
          const existing = ptyManager.getSession(sessionId);
          if (existing?.needsConsent) {
            socket.emit('terminal:consent', { sessionId });
          }
          return;
        }

        console.log(`[terminal] Spawning PTY for ${session.name} in ${session.cwd}`);
        ptyManager.spawn(sessionId, {
          cwd: session.cwd,
          resumeName: session.name,
        });

        // Stream raw PTY output to this socket
        ptyManager.onOutput(sessionId, (data) => {
          socket.emit('terminal:data', { sessionId, data });
        });

        // Notify if consent is needed
        const ptySession = ptyManager.getSession(sessionId);
        if (ptySession) {
          ptySession.onConsent = () => {
            io.emit('terminal:consent', { sessionId });
          };
          // If already needs consent, emit immediately
          if (ptySession.needsConsent) {
            io.emit('terminal:consent', { sessionId });
          }
        }
      } catch (err) {
        console.error('[terminal:spawn]', err);
        socket.emit('terminal:exit', { sessionId, exitCode: -1 });
      }
    });

    // Forward keystrokes from xterm.js to PTY
    socket.on('terminal:input', ({ sessionId, data }) => {
      const ptySession = ptyManager.getSession(sessionId);
      if (ptySession && ptySession.status !== 'closed') {
        ptySession.pty.write(data);
      }
    });

    // Handle terminal resize
    socket.on('terminal:resize', ({ sessionId, cols, rows }) => {
      const ptySession = ptyManager.getSession(sessionId);
      if (ptySession && ptySession.status !== 'closed') {
        ptySession.pty.resize(cols, rows);
      }
    });
  });
}
