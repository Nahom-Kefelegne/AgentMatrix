import { createServer } from 'http';
import next from 'next';
import { Server as SocketIOServer } from 'socket.io';
import { SOCKET_EVENTS } from './lib/types';
import { SOCKET_PATH } from './lib/constants';
import { startSessionScanner } from './lib/state/sessionScanner';

const dev = process.env.NODE_ENV !== 'production';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev });
const handle = app.getRequestHandler();

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
