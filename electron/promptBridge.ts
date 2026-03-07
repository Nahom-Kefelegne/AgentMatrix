import type { Server as SocketIOServer } from 'socket.io';
import { PtyManager } from './pty/PtyManager';
import { OutputParser } from './pty/OutputParser';
import { getSession } from '../lib/state/sessionStore';

// Track last sent prompt per session for echo filtering
const lastPrompts = new Map<string, string>();
// Track if echo has been consumed for this prompt
const echoConsumed = new Map<string, boolean>();

export function setupPromptBridge(io: SocketIOServer, ptyManager: PtyManager): void {
  io.on('connection', (socket) => {
    socket.on('prompt:send', ({ sessionId, prompt }) => {
      try {
        const session = getSession(sessionId);
        if (!session) {
          socket.emit('prompt:error', { sessionId, error: 'Session not found' });
          return;
        }

        console.log(`[prompt:send] session=${session.name} prompt="${prompt.slice(0, 60)}"`);

        // Store prompt for echo filtering
        lastPrompts.set(sessionId, prompt);
        echoConsumed.set(sessionId, false);

        // Spawn PTY if needed
        if (!ptyManager.hasPty(sessionId)) {
          console.log(`[prompt] Spawning PTY for ${session.name} in ${session.cwd}`);
          ptyManager.spawn(sessionId, {
            cwd: session.cwd,
            resumeName: session.name,
          });

          // Subscribe to output
          ptyManager.onOutput(sessionId, (data) => {
            console.log(`[pty:raw] ${JSON.stringify(data).slice(0, 150)}`);
            const clean = OutputParser.stripAnsi(data);
            if (!clean.trim()) return;

            // Filter out echo of the prompt we just sent (only once)
            const lastPrompt = lastPrompts.get(sessionId);
            if (lastPrompt && !echoConsumed.get(sessionId) && OutputParser.isEcho(clean, lastPrompt)) {
              console.log(`[pty:echo-filtered] ${clean.slice(0, 80)}`);
              echoConsumed.set(sessionId, true);
              return;
            }

            console.log(`[pty:emit] ${clean.slice(0, 120)}`);
            io.emit('prompt:output', { sessionId, text: clean });
          });

          // Notify when Claude is ready for input
          ptyManager.onReady(sessionId, () => {
            console.log(`[pty:ready] ${session.name}`);
            io.emit('prompt:ready', { sessionId });
          });
        }

        ptyManager.sendPrompt(sessionId, prompt);
      } catch (err) {
        console.error(`[prompt:error]`, err);
        socket.emit('prompt:error', { sessionId, error: String(err) });
      }
    });
  });
}
