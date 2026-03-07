import { spawn } from 'child_process';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { Server as SocketIOServer } from 'socket.io';
import { getSession } from '../lib/state/sessionStore';

function findClaudeBinary(): string {
  const cmd = process.platform === 'win32' ? 'where claude' : 'which claude';
  return execSync(cmd, { encoding: 'utf-8' }).trim().split('\n')[0];
}

function findSessionCwd(sessionId: string): string | undefined {
  try {
    const projectsDir = join(homedir(), '.claude', 'projects');
    const output = execSync(
      `find "${projectsDir}" -name "${sessionId}.jsonl" -type f 2>/dev/null`,
      { encoding: 'utf-8', timeout: 5000 },
    ).trim();
    if (!output) return undefined;
    const parts = output.split('/');
    const idx = parts.indexOf('projects');
    if (idx < 0 || idx + 1 >= parts.length) return undefined;
    const derived = parts[idx + 1].replace(/^-/, '/').replace(/-/g, '/');
    return existsSync(derived) ? derived : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Prompt bridge using --print mode.
 * Each prompt spawns `claude --print --resume <id> --fork-session` as a child process.
 * This gives clean text output without terminal noise.
 */
export function setupPromptBridge(io: SocketIOServer): void {
  io.on('connection', (socket) => {
    socket.on('prompt:send', ({ sessionId, prompt }) => {
      try {
        const session = getSession(sessionId);
        if (!session) {
          socket.emit('prompt:error', { sessionId, error: 'Session not found' });
          return;
        }

        const claudePath = findClaudeBinary();
        const cwd = findSessionCwd(sessionId) ?? session.cwd ?? homedir();

        console.log(`[prompt:send] session=${session.name} prompt="${prompt.slice(0, 60)}" cwd=${cwd}`);

        const env = { ...process.env };
        delete env.CLAUDECODE;

        const args = [
          '--print',
          '--resume', sessionId,
          '--fork-session',
          '--dangerously-skip-permissions',
          '--output-format', 'text',
          prompt,
        ];

        const child = spawn(claudePath, args, {
          cwd,
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        let output = '';

        child.stdout.on('data', (chunk: Buffer) => {
          const text = chunk.toString('utf-8');
          output += text;
          io.emit('prompt:output', { sessionId, text });
        });

        child.stderr.on('data', (chunk: Buffer) => {
          console.log(`[prompt:stderr] ${chunk.toString('utf-8').slice(0, 200)}`);
        });

        child.on('close', (code) => {
          console.log(`[prompt:done] session=${session.name} code=${code} len=${output.length}`);
          if (code !== 0 && !output.trim()) {
            io.emit('prompt:error', { sessionId, error: `Process exited with code ${code}` });
          }
          io.emit('prompt:ready', { sessionId });
        });

        child.on('error', (err) => {
          console.error('[prompt:spawn-error]', err);
          io.emit('prompt:error', { sessionId, error: err.message });
        });
      } catch (err) {
        console.error('[prompt:error]', err);
        socket.emit('prompt:error', { sessionId, error: String(err) });
      }
    });
  });
}
