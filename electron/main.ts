import { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain } from 'electron';
import path from 'path';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { SOCKET_EVENTS } from '../lib/types';
import { SOCKET_PATH } from '../lib/constants';
import { getAllSessions, addSession, updateSession } from '../lib/state/sessionStore';
import { getCachedName } from '../lib/state/nameCache';
import { getSettings } from '../lib/state/appSettings';
import { getActiveSessions } from '../lib/state/activeSessionsCache';
import { PtyManager } from './pty/PtyManager';
import { OutputParser } from './pty/OutputParser';
import { setupTerminalBridge, requestSummary } from './terminalBridge';
import { spawnOrchestrator, killOrchestrator, isOrchestrator } from './services/OrchestratorService';
import { reapOrphansOnStartup, logReapResult } from './services/OrphanReaper';
import { migrateStateStorage } from '../lib/state/migrateStateStorage';

const isDev = process.env.NODE_ENV !== 'production';
const port = parseInt(process.env.PORT || '3000', 10);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
export let io: SocketIOServer | null = null;
const ptyManager = new PtyManager();

// Graceful shutdown flag — set true when user initiates quit. The window
// `close` handler checks this to let windows actually close during quit
// instead of hiding (Mac tray behavior).
let shuttingDown = false;

// Direct IPC for terminal keystrokes — bypasses Socket.io for zero-latency input
ipcMain.on('terminal:write', (_event, sessionId: string, data: string) => {
  const session = ptyManager.getSession(sessionId);
  if (session && session.status !== 'closed') {
    session.pty.write(data);
  }
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#08080f',
    autoHideMenuBar: !isDev,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Show immediately with splash while server starts
  const splashPath = path.join(__dirname, '..', 'public', 'splash.html');
  mainWindow.loadFile(splashPath);
  mainWindow.once('ready-to-show', () => mainWindow?.show());

  mainWindow.on('close', (e) => {
    // On macOS, clicking red X / Cmd+W hides the window (keeps app in tray).
    // BUT when the app is actually quitting (Cmd+Q / Menu Quit / tray Quit),
    // let the window close normally so the quit can proceed.
    if (process.platform === 'darwin' && !shuttingDown) {
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

async function startServer(): Promise<void> {
  const appDir = path.join(__dirname, '..');
  let httpServer: ReturnType<typeof createServer>;

  if (isDev) {
    const next = require('next');
    const nextApp = next({ dev: true, dir: appDir });
    const handle = nextApp.getRequestHandler();
    await nextApp.prepare();
    httpServer = createServer((req, res) => handle(req, res));
  } else {
    const standaloneDir = path.join(appDir, '.next', 'standalone');
    process.env.PORT = String(port);
    process.env.HOSTNAME = 'localhost';
    process.chdir(standaloneDir);

    const { parse } = require('url');
    const NextServer = require('next/dist/server/next-server').default;
    const conf = require(path.join(standaloneDir, '.next', 'required-server-files.json')).config;
    const nextServer = new NextServer({
      hostname: 'localhost',
      port,
      dir: standaloneDir,
      dev: false,
      customServer: true,
      conf,
    });
    const handler = nextServer.getRequestHandler();
    httpServer = createServer((req, res) => handler(req, res, parse(req.url || '', true)));
  }

  return new Promise((resolve) => {

      io = new SocketIOServer(httpServer, {
        path: SOCKET_PATH,
        addTrailingSlash: false,
        cors: { origin: '*' },
      });

      (globalThis as Record<string, unknown>).__socketIO = io;

      io.on('connection', (socket) => {
        // Exclude orchestrator from client-visible sessions
        const visible = getAllSessions().filter(s => !isOrchestrator(s.id));
        socket.emit(SOCKET_EVENTS.STATE_SNAPSHOT, visible);
        // Send orchestrator ID so client can access it
        const { getOrchestratorId } = require('./services/OrchestratorService');
        const orchId = getOrchestratorId();
        if (orchId) socket.emit('orchestrator:id', { sessionId: orchId });
      });

      setupTerminalBridge(io!, ptyManager);

      // Spawn orchestrator session (hidden, app-only)
      spawnOrchestrator(ptyManager);

      httpServer.listen(port, () => {
        console.log(`> Server ready on http://localhost:${port}`);

        // Reap orphan CLI processes from previous app runs BEFORE auto-resuming.
        // When Electron crashes / force-quits, its PTY children (claude/copilot)
        // survive. If we auto-resume the same session, we'd have two processes
        // writing to the same transcript .jsonl, which corrupts parent UUIDs
        // and makes "thousands of lines disappear on resume". Killing orphans
        // first prevents this race entirely.
        try {
          const reaped = reapOrphansOnStartup();
          logReapResult('startup', reaped);
        } catch (err) {
          console.error('[orphan-reaper] failed:', err);
          // Don't block startup if reaper fails — just log it
        }

        // Auto-resume sessions from last run
        const settings = getSettings();
        const summaryPromises: Promise<void>[] = [];

        if (settings.autoResume) {
          const cached = getActiveSessions();
          if (cached.length > 0) {
            console.log(`[auto-resume] Resuming ${cached.length} session(s)...`);
            for (const s of cached) {
              try {
                const name = getCachedName(s.id) || s.name;
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
                  recentActions: [], agents: [], cwd: s.cwd,
                  cliType: s.cliType || ('claude' as const),
                  createdAt: Date.now(),
                };
                addSession(sessionData);
                io!.emit(SOCKET_EVENTS.SESSION_START, sessionData);

                ptyManager.spawnResume(s.id, { cwd: s.cwd, resumeId: s.id, cliType: s.cliType || 'claude' });
                const pty = ptyManager.getSession(s.id);
                if (pty) {
                  pty.onStateChange = (info) => io!.emit('session:state', { sessionId: s.id, ...info });
                  pty.onContextUpdate = (usage) => {
                    io!.emit('session:context', { sessionId: s.id, usage });
                  };

                  // Watch for interactive prompts during resume (trust, large context, etc.)
                  // Auto-accept to prevent sessions hanging on unattended prompts
                  const prevOnData = pty.onData;
                  let resumeBuffer = '';
                  let handled = false;
                  const resumeMonitor = (data: string) => {
                    if (prevOnData) prevOnData(data);
                    if (handled) return;
                    resumeBuffer += data;
                    const clean = OutputParser.stripAnsi(resumeBuffer);
                    // Trust prompt
                    if (clean.includes('trust this folder') || clean.includes('trust this project') ||
                        clean.includes('Is this a project') || clean.includes('Yes, I trust')) {
                      handled = true;
                      console.log(`[auto-resume] ${name}: detected trust prompt, auto-accepting`);
                      setTimeout(() => pty.pty.write('\r'), 300);
                    }
                    // Large context / compaction prompt — pick "continue as-is" (usually first option / Enter)
                    if (clean.includes('conversation is getting long') || clean.includes('context is large') ||
                        clean.includes('continue as-is') || clean.includes('start fresh') ||
                        clean.includes('compact') || clean.includes('summarize the conversation')) {
                      handled = true;
                      console.log(`[auto-resume] ${name}: detected context prompt, choosing continue as-is`);
                      setTimeout(() => pty.pty.write('\r'), 300);
                      io!.emit('session:context-warning', { sessionId: s.id, message: 'Session context is large — resumed as-is' });
                    }
                  };
                  pty.onData = resumeMonitor;
                  // Stop monitoring after 30s
                  setTimeout(() => {
                    if (pty.onData === resumeMonitor) {
                      pty.onData = prevOnData;
                    }
                  }, 30000);
                }
                console.log(`[auto-resume] ${name} (${s.id.slice(0, 8)})`);
              } catch (err) {
                console.error(`[auto-resume] Failed: ${s.name}`, err);
              }
            }
          }
        }

        // Pre-fetch tasks so TaskBoard doesn't block on open
        const prefetchTasks = async () => {
          try {
            // Trigger the sync + fetch by hitting our own API
            const res = await fetch(`http://localhost:${port}/api/app-tasks`);
            const data = await res.json();
            io!.emit('app:tasks-loaded', { tasks: data.tasks || [] });
          } catch {}
          try {
            const res = await fetch(`http://localhost:${port}/api/ado?action=check`);
            const data = await res.json();
            if (data.config?.configured) {
              const adoRes = await fetch(`http://localhost:${port}/api/ado?action=tasks`);
              const adoData = await adoRes.json();
              io!.emit('app:ado-tasks-loaded', { tasks: adoData.tasks || [] });
            }
          } catch {}
        };

        // Signal app ready after summaries + task prefetch complete
        Promise.all([...summaryPromises, prefetchTasks()]).then(() => {
          io!.emit('app:ready');
          console.log('[app] ready');
        });
        // Also signal ready after max 90s regardless
        setTimeout(() => io!.emit('app:ready'), 90000);

        resolve();
      });
  });
}

app.whenReady().then(async () => {
  // One-shot migration of state files from ~/.claude/agentmatrix-* to
  // ~/.agentmatrix/*. Idempotent and fast (~6 stat calls in the no-op
  // case). Runs before any state module touches disk.
  migrateStateStorage();

  createWindow();
  createTray();
  await startServer();
  // Navigate to app now that server is ready
  mainWindow?.loadURL(`http://localhost:${port}`);
  // DevTools available via Cmd+Option+I if needed

  app.on('activate', () => {
    if (mainWindow) mainWindow.show();
    else createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Graceful shutdown — intercept quit, cleanly close all sessions so their
// SessionEnd hooks fire and transcripts are flushed, then force-exit.
// Without this, PTY processes get SIGKILL'd on app exit and transcripts can
// be left in an inconsistent state with no sessionEnd hook firing.
app.on('before-quit', async (e) => {
  // Always prevent the default quit during shutdown. This blocks re-entry
  // from spammed Cmd+Q presses that would otherwise SIGKILL mid-shutdown.
  if (shuttingDown) {
    e.preventDefault();
    return;
  }
  shuttingDown = true;
  e.preventDefault();

  // Tell the UI (if still open) that we're closing
  try { io?.emit('app:shutting-down', { count: ptyManager.getAllSessions().length }); } catch {}

  try {
    // Send /exit to all sessions, wait up to 5s for clean close, force-kill stragglers
    await ptyManager.gracefulShutdown(5000);
  } catch (err) {
    console.error('[shutdown] gracefulShutdown error:', err);
  }

  // Orchestrator is a regular PtyManager session, so it's already closed by
  // gracefulShutdown. This is a no-op safety net for orchestrator state cleanup.
  try { killOrchestrator(); } catch {}

  // Force-exit to bypass the before-quit/close event loop entirely.
  // app.quit() would re-fire before-quit and try to close windows, which
  // is fragile. app.exit() skips all of that and terminates immediately.
  app.exit(0);
});

app.on('will-quit', () => {
  // Final safety net in case shutdown was bypassed (e.g., external SIGTERM)
  if (!shuttingDown) {
    killOrchestrator();
    ptyManager.dispose();
  }
});
