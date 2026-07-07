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
import { getProvider } from '../lib/cli';

// Dev vs prod is determined by whether Electron is running from a packaged
// app bundle — NOT by NODE_ENV, which is unset when a packaged app is
// launched by double-click and would wrongly select the dev server path.
const isDev = !app.isPackaged;
const port = parseInt(process.env.PORT || '3000', 10);

// Smoke-test mode for CI / build verification: boot the server + window but
// skip all destructive/stateful startup (orphan reaping, auto-resume,
// orchestrator). Lets a packaged build be launched safely to confirm it runs
// without touching the user's live sessions or killing real CLI processes.
const SMOKE_TEST = process.env.AGENTMATRIX_SMOKE_TEST === '1';

// All HTTP/Socket.io traffic stays on the loopback interface. Binding to
// 127.0.0.1 (not 0.0.0.0) means no other machine on the LAN/VPN can reach the
// API. This matters because several routes execute CLI commands (e.g.
// /api/sessions/spawn runs `claude --dangerously-skip-permissions <task>`),
// so an externally-reachable port would be a remote-code-execution surface.
const LOOPBACK_HOST = '127.0.0.1';

// Reject any request whose Host header isn't loopback. This blocks DNS
// rebinding: a malicious web page can resolve its own domain to 127.0.0.1 and
// make the browser POST to our API, but the Host header still carries the
// attacker's domain, which we refuse here. Legitimate clients — the app's own
// renderer and the CLI hooks (curl → localhost) — always send a
// localhost/127.0.0.1 Host.
function isLoopbackHost(hostHeader: string | undefined): boolean {
  const host = (hostHeader || '').split(':')[0].toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

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
    httpServer = createServer((req, res) => {
      if (!isLoopbackHost(req.headers.host)) { res.statusCode = 403; res.end('Forbidden'); return; }
      handle(req, res);
    });
  } else {
    const standaloneDir = path.join(appDir, '.next', 'standalone');
    process.env.PORT = String(port);
    process.env.HOSTNAME = LOOPBACK_HOST;
    process.chdir(standaloneDir);

    const { parse } = require('url');
    const NextServer = require('next/dist/server/next-server').default;
    const conf = require(path.join(standaloneDir, '.next', 'required-server-files.json')).config;
    const nextServer = new NextServer({
      hostname: LOOPBACK_HOST,
      port,
      dir: standaloneDir,
      dev: false,
      customServer: true,
      conf,
    });
    const handler = nextServer.getRequestHandler();
    httpServer = createServer((req, res) => {
      if (!isLoopbackHost(req.headers.host)) { res.statusCode = 403; res.end('Forbidden'); return; }
      handler(req, res, parse(req.url || '', true));
    });
  }

  return new Promise((resolve) => {

      io = new SocketIOServer(httpServer, {
        path: SOCKET_PATH,
        addTrailingSlash: false,
        // Only the app's own loopback origin may connect; and the websocket
        // upgrade is gated on a loopback Host header (same DNS-rebind guard
        // as the HTTP routes — the upgrade request bypasses the createServer
        // handler above, so it's enforced here too).
        cors: { origin: [/^https?:\/\/localhost(:\d+)?$/, /^https?:\/\/127\.0\.0\.1(:\d+)?$/] },
        allowRequest: (req, cb) => cb(null, isLoopbackHost(req.headers.host)),
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
      if (!SMOKE_TEST) spawnOrchestrator(ptyManager);

      httpServer.listen(port, LOOPBACK_HOST, () => {
        console.log(`> Server ready on http://${LOOPBACK_HOST}:${port}`);

        // Reap orphan CLI processes from previous app runs BEFORE auto-resuming.
        // When Electron crashes / force-quits, its PTY children (claude/copilot)
        // survive. If we auto-resume the same session, we'd have two processes
        // writing to the same transcript .jsonl, which corrupts parent UUIDs
        // and makes "thousands of lines disappear on resume". Killing orphans
        // first prevents this race entirely.
        if (!SMOKE_TEST) {
          try {
            const reaped = reapOrphansOnStartup();
            logReapResult('startup', reaped);
          } catch (err) {
            console.error('[orphan-reaper] failed:', err);
            // Don't block startup if reaper fails — just log it
          }
        }

        // Auto-resume sessions from last run
        const settings = getSettings();
        const summaryPromises: Promise<void>[] = [];

        if (settings.autoResume && !SMOKE_TEST) {
          const cached = getActiveSessions();
          if (cached.length > 0) {
            console.log(`[auto-resume] Resuming ${cached.length} session(s)...`);
            const resumeStaggerMs = settings.useAgency ? 1500 : 0;
            const resumeOne = (s: typeof cached[number]) => {
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

                  // Watch for interactive prompts during resume (trust,
                  // large-context compaction, etc.) and auto-accept so
                  // unattended sessions don't hang. Pattern lists come
                  // from the provider — they know what their own CLI
                  // prints.
                  const resumeProvider = getProvider(s.cliType || 'claude');
                  const trustPatterns = resumeProvider.getTrustPromptPatterns();
                  const contextPatterns = resumeProvider.getContextPromptPatterns();
                  let resumeBuffer = '';
                  let handled = false;
                  const resumeMonitor = (data: string) => {
                    if (handled) return;
                    resumeBuffer += data;
                    const clean = OutputParser.stripAnsi(resumeBuffer);
                    if (trustPatterns.some(p => clean.includes(p))) {
                      handled = true;
                      console.log(`[auto-resume] ${name}: detected trust prompt, auto-accepting`);
                      setTimeout(() => pty.pty.write('\r'), 300);
                      pty.subscribers.delete(resumeMonitor);
                      return;
                    }
                    if (contextPatterns.some(p => clean.includes(p))) {
                      handled = true;
                      console.log(`[auto-resume] ${name}: detected context prompt, choosing continue as-is`);
                      setTimeout(() => pty.pty.write('\r'), 300);
                      io!.emit('session:context-warning', { sessionId: s.id, message: 'Session context is large — resumed as-is' });
                      pty.subscribers.delete(resumeMonitor);
                    }
                  };
                  pty.subscribers.add(resumeMonitor);
                  setTimeout(() => { pty.subscribers.delete(resumeMonitor); }, 30000);
                }
                console.log(`[auto-resume] ${name} (${s.id.slice(0, 8)})`);
              } catch (err) {
                console.error(`[auto-resume] Failed: ${s.name}`, err);
              }
            };
            for (const [index, s] of cached.entries()) {
              if (resumeStaggerMs > 0 && index > 0) {
                setTimeout(() => resumeOne(s), index * resumeStaggerMs);
              } else {
                resumeOne(s);
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

// Prevent two copies of the SAME packaged app from running at once. Two
// instances share ~/.agentmatrix state and would both auto-resume the same
// cached sessions, racing two writers into one transcript .jsonl and breaking
// its parent-UUID chain. The second launch just surfaces the existing window
// and exits.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
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
  // Navigate to app now that server is ready. Use 127.0.0.1 explicitly so the
  // renderer connects to the loopback address the server is bound to, with no
  // dependence on how "localhost" resolves (IPv4 vs IPv6).
  mainWindow?.loadURL(`http://${LOOPBACK_HOST}:${port}`);
  // DevTools available via Cmd+Option+I if needed

  app.on('activate', () => {
    if (mainWindow) mainWindow.show();
    else createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

async function closeLiveSessionsForExit(reason: string): Promise<void> {
  console.log(`[shutdown] ${reason}: closing sessions...`);
  try { io?.emit('app:shutting-down', { count: ptyManager.getAllSessions().length }); } catch {}

  try {
    await ptyManager.gracefulShutdown(5000);
  } catch (err) {
    console.error('[shutdown] gracefulShutdown error:', err);
  }

  try { killOrchestrator(); } catch {}

  // Keep active-sessions.json intact. Auto-resume is the user-facing contract:
  // after a clean shutdown the next launch should restore the same desks. The
  // orphan reaper still protects against duplicate writers before resume.
}

async function exitFromSignal(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await closeLiveSessionsForExit(signal);
  process.exit(0);
}

process.on('SIGINT', () => void exitFromSignal('SIGINT'));
process.on('SIGTERM', () => void exitFromSignal('SIGTERM'));

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

  await closeLiveSessionsForExit('before-quit');

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
