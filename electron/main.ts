import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron';
import path from 'path';
import { createServer } from 'http';
import next from 'next';
import { Server as SocketIOServer } from 'socket.io';
import { SOCKET_EVENTS } from '../lib/types';
import { SOCKET_PATH } from '../lib/constants';
import { getAllSessions, addSession, updateSession } from '../lib/state/sessionStore';
import { getCachedName } from '../lib/state/nameCache';
import { getSettings } from '../lib/state/appSettings';
import { getActiveSessions } from '../lib/state/activeSessionsCache';
import { PtyManager } from './pty/PtyManager';
import { setupTerminalBridge } from './terminalBridge';

const isDev = process.env.NODE_ENV !== 'production';
const port = parseInt(process.env.PORT || '3000', 10);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
export let io: SocketIOServer | null = null;
const ptyManager = new PtyManager();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#0a0a14',
    autoHideMenuBar: !isDev,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://localhost:${port}`);

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('close', (e) => {
    if (process.platform === 'darwin') {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
}

function createTray() {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('Agent Matrix');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show', click: () => mainWindow?.show() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', () => mainWindow?.show());
}

function startServer(): Promise<void> {
  return new Promise((resolve) => {
    const nextApp = next({ dev: isDev, dir: path.join(__dirname, '..') });
    const handle = nextApp.getRequestHandler();

    nextApp.prepare().then(() => {
      const httpServer = createServer((req, res) => {
        handle(req, res);
      });

      io = new SocketIOServer(httpServer, {
        path: SOCKET_PATH,
        addTrailingSlash: false,
        cors: { origin: '*' },
      });

      (globalThis as Record<string, unknown>).__socketIO = io;

      io.on('connection', (socket) => {
        socket.emit(SOCKET_EVENTS.STATE_SNAPSHOT, getAllSessions());
      });

      setupTerminalBridge(io!, ptyManager);

      httpServer.listen(port, () => {
        console.log(`> Server ready on http://localhost:${port}`);

        // Auto-resume sessions from last run
        const settings = getSettings();
        if (settings.autoResume) {
          const cached = getActiveSessions();
          if (cached.length > 0) {
            console.log(`[auto-resume] Resuming ${cached.length} session(s)...`);
            for (const s of cached) {
              try {
                const name = getCachedName(s.id) || s.name;
                // Import createSessionEntry logic inline
                const { DESK_POSITIONS: DP, OVERFLOW_POSITIONS: OP, ENTRANCE_POINT: EP, CHARACTER_COLORS: CC } = require('../lib/constants');
                const all = getAllSessions();
                const used = new Set(all.map((x: any) => x.deskIndex));
                let di = 0;
                for (let i = 0; i < DP.length + OP.length; i++) { if (!used.has(i)) { di = i; break; } }
                const dp = di < DP.length ? DP[di] : di < DP.length + OP.length ? OP[di - DP.length] : EP;
                const ci = all.length % CC.length;

                const sessionData = {
                  id: s.id, name, color: CC[ci], status: 'idle' as const,
                  deskIndex: di, deskPosition: dp, spawnPosition: EP,
                  recentActions: [], agents: [], cwd: s.cwd, createdAt: Date.now(),
                };
                addSession(sessionData);
                io!.emit(SOCKET_EVENTS.SESSION_START, sessionData);

                ptyManager.spawnResume(s.id, { cwd: s.cwd, resumeId: s.id });
                // Wire up callbacks
                const pty = ptyManager.getSession(s.id);
                if (pty) {
                  pty.onStateChange = (info) => io!.emit('session:state', { sessionId: s.id, ...info });
                  pty.onContextUpdate = (usage) => {
                    io!.emit('session:context', { sessionId: s.id, usage });
                  };
                }
                console.log(`[auto-resume] ${name} (${s.id.slice(0, 8)})`);
              } catch (err) {
                console.error(`[auto-resume] Failed: ${s.name}`, err);
              }
            }
          }
        }

        resolve();
      });
    });
  });
}

app.whenReady().then(async () => {
  await startServer();
  createWindow();
  createTray();

  app.on('activate', () => {
    if (mainWindow) mainWindow.show();
    else createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  ptyManager.dispose();
});
