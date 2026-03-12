import { createServer } from 'http';
import next from 'next';
import { Server as SocketIOServer } from 'socket.io';
import { SOCKET_EVENTS } from './lib/types';
import { SOCKET_PATH } from './lib/constants';
import { startSessionScanner } from './lib/state/sessionScanner';
import { existsSync } from 'fs';
import { homedir } from 'os';

const dev = process.env.NODE_ENV !== 'production';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev });
const handle = app.getRequestHandler();

/** Lightweight editor shell terminal management (works without Electron) */
function setupEditorTerminals(socket: any) {
  socket.on('editor:terminal:spawn', ({ id, cwd, cols, rows }: { id: string; cwd: string; cols?: number; rows?: number }) => {
    console.log(`[editor:terminal] spawn id=${id} cwd=${cwd}`);
    try {
      const pty = require('node-pty');
      const safeCwd = existsSync(cwd) ? cwd : homedir();
      const shell = process.platform === 'win32'
        ? 'cmd.exe'
        : (process.env.SHELL || '/bin/zsh');

      // Clean env: remove npm/Electron vars that break nvm and shell behavior
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) {
        if (!v) continue;
        if (k.startsWith('npm_')) continue;
        if (k === 'NODE_ENV' || k === 'ELECTRON_RUN_AS_NODE') continue;
        env[k] = v;
      }
      env.TERM = 'xterm-256color';

      const proc = pty.spawn(shell, ['-l'], {
        cwd: safeCwd,
        cols: cols || 120,
        rows: rows || 24,
        env,
      });
      console.log(`[editor:terminal] spawned pid=${proc.pid}`);

      const g = globalThis as Record<string, unknown>;
      if (!g.__editorTerminals) g.__editorTerminals = new Map();
      const terminals = g.__editorTerminals as Map<string, { proc: any; buffer: string[] }>;

      const entry = { proc, buffer: [] as string[] };
      terminals.set(id, entry);

      proc.onData((data: string) => {
        entry.buffer.push(data);
        if (entry.buffer.length > 300) entry.buffer = entry.buffer.slice(-200);
        socket.emit('editor:terminal:data', { id, data });
      });

      proc.onExit(({ exitCode }: { exitCode: number }) => {
        socket.emit('editor:terminal:exit', { id, exitCode });
        terminals.delete(id);
      });

      socket.emit('editor:terminal:ready', { id });
    } catch (err) {
      console.error('[editor:terminal:spawn]', err);
      socket.emit('editor:terminal:exit', { id, exitCode: 1 });
    }
  });

  socket.on('editor:terminal:input', ({ id, data }: { id: string; data: string }) => {
    const g = globalThis as Record<string, unknown>;
    const terminals = g.__editorTerminals as Map<string, { proc: any; buffer: string[] }> | undefined;
    terminals?.get(id)?.proc.write(data);
  });

  socket.on('editor:terminal:resize', ({ id, cols, rows }: { id: string; cols: number; rows: number }) => {
    const g = globalThis as Record<string, unknown>;
    const terminals = g.__editorTerminals as Map<string, { proc: any; buffer: string[] }> | undefined;
    terminals?.get(id)?.proc.resize(cols, rows);
  });

  socket.on('editor:terminal:kill', ({ id }: { id: string }) => {
    const g = globalThis as Record<string, unknown>;
    const terminals = g.__editorTerminals as Map<string, { proc: any; buffer: string[] }> | undefined;
    const entry = terminals?.get(id);
    if (entry) { entry.proc.kill(); terminals!.delete(id); }
  });

  socket.on('editor:terminal:attach', ({ id }: { id: string }) => {
    const g = globalThis as Record<string, unknown>;
    const terminals = g.__editorTerminals as Map<string, { proc: any; buffer: string[] }> | undefined;
    const entry = terminals?.get(id);
    if (entry && entry.buffer.length > 0) {
      socket.emit('editor:terminal:data', { id, data: entry.buffer.join('') });
    }
  });
}

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    handle(req, res);
  });

  const io = new SocketIOServer(httpServer, {
    path: SOCKET_PATH,
    addTrailingSlash: false,
    cors: { origin: '*' },
  });

  (globalThis as Record<string, unknown>).__socketIO = io;

  io.on('connection', (socket) => {
    import('./lib/state/sessionStore').then(({ getAllSessions }) => {
      socket.emit(SOCKET_EVENTS.STATE_SNAPSHOT, getAllSessions());
    });

    // Editor shell terminals
    setupEditorTerminals(socket);
  });

  // Scan for active Claude sessions on startup and every 10s
  startSessionScanner((added, removed, updated) => {
    for (const session of added) {
      console.log(`[scanner] Discovered session: ${session.name} (${session.id.slice(0, 8)}...)`);
      io.emit(SOCKET_EVENTS.SESSION_START, session);
    }
    for (const sessionId of removed) {
      console.log(`[scanner] Session ended: ${sessionId.slice(0, 8)}...`);
      io.emit(SOCKET_EVENTS.SESSION_END, { sessionId });
    }
    for (const u of updated) {
      console.log(`[scanner] Updated name: ${u.name} (${u.sessionId.slice(0, 8)}...)`);
      io.emit(SOCKET_EVENTS.SESSION_UPDATE, {
        sessionId: u.sessionId,
        changes: { name: u.name },
      });
    }
  });

  httpServer.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`);
  });
});
