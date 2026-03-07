import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron';
import path from 'path';
import { createServer } from 'http';
import next from 'next';
import { Server as SocketIOServer } from 'socket.io';
import { SOCKET_EVENTS } from '../lib/types';
import { SOCKET_PATH } from '../lib/constants';
import { startSessionScanner } from '../lib/state/sessionScanner';
import { getAllSessions } from '../lib/state/sessionStore';
import { PtyManager } from './pty/PtyManager';
import { setupPromptBridge } from './promptBridge';
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
    {
      label: 'Show',
      click: () => {
        mainWindow?.show();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    mainWindow?.show();
  });
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

      startSessionScanner((added, removed, updated) => {
        for (const session of added) {
          console.log(`[scanner] Discovered session: ${session.name} (${session.id.slice(0, 8)}...)`);
          io!.emit(SOCKET_EVENTS.SESSION_START, session);
        }
        for (const sessionId of removed) {
          console.log(`[scanner] Session ended: ${sessionId.slice(0, 8)}...`);
          io!.emit(SOCKET_EVENTS.SESSION_END, { sessionId });
        }
        for (const u of updated) {
          console.log(`[scanner] Updated name: ${u.name} (${u.sessionId.slice(0, 8)}...)`);
          io!.emit(SOCKET_EVENTS.SESSION_UPDATE, {
            sessionId: u.sessionId,
            changes: { name: u.name },
          });
        }
      });

      setupPromptBridge(io!, ptyManager);
      setupTerminalBridge(io!, ptyManager);

      httpServer.listen(port, () => {
        console.log(`> Server ready on http://localhost:${port}`);
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
    if (mainWindow) {
      mainWindow.show();
    } else {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  ptyManager.dispose();
});
