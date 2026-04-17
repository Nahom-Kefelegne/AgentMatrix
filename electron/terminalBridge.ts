import type { Server as SocketIOServer } from 'socket.io';
import { PtyManager } from './pty/PtyManager';
import { randomUUID } from 'crypto';
import { homedir } from 'os';
import { addSession, getAllSessions, getSession, removeSession, updateSession } from '../lib/state/sessionStore';
import { setCachedName } from '../lib/state/nameCache';
import { getActiveSessions, saveActiveSessions } from '../lib/state/activeSessionsCache';
import { SOCKET_EVENTS } from '../lib/types';
import type { SessionData } from '../lib/types';
import {
  DESK_POSITIONS, OVERFLOW_POSITIONS, ENTRANCE_POINT, CHARACTER_COLORS,
} from '../lib/constants';
import { requestSummary } from './services/SummaryService';
import { queryOrchestrator, getOrchestratorId, isOrchestrator, resetOrchestrator } from './services/OrchestratorService';
import { generateHandoffSummary, injectHandoffIntoSession } from './services/HandoffService';
import { OutputParser } from './pty/OutputParser';
import type { PtySession } from './pty/PtyManager';
export { requestSummary };

/**
 * Watch newly spawned session output for trust/permission prompts and auto-accept them.
 * Works for both Claude ("trust this folder") and Copilot ("Do you trust the files in this folder").
 */
function watchForTrustPrompt(ptyManager: PtyManager, sessionId: string, sessionName: string): void {
  const ptySession = ptyManager.getSession(sessionId);
  if (!ptySession) return;

  let buffer = '';
  let accepted = false;
  const prevOnData = ptySession.onData;

  const monitor = (data: string) => {
    if (prevOnData) prevOnData(data);
    if (accepted) return;

    buffer += data;
    const clean = OutputParser.stripAnsi(buffer);

    // Detect trust prompts from either Claude or Copilot
    if (clean.includes('trust this folder') || clean.includes('trust this project') ||
        clean.includes('Do you trust the files') || clean.includes('Confirm folder trust') ||
        clean.includes('Is this a project') || clean.includes('Yes, I trust')) {
      accepted = true;
      console.log(`[trust-prompt] ${sessionName}: detected trust prompt, auto-accepting...`);
      // Send Enter to accept the pre-selected "Yes" / "Yes, I trust" option
      setTimeout(() => ptySession.pty.write('\r'), 300);
      // Restore original handler after acceptance
      setTimeout(() => {
        if (ptySession.onData === monitor) ptySession.onData = prevOnData;
      }, 2000);
      return;
    }

    if (buffer.length > 10000) buffer = buffer.slice(-5000);
  };

  ptySession.onData = monitor;

  // Stop monitoring after 30s
  setTimeout(() => {
    if (!accepted && ptySession.onData === monitor) {
      ptySession.onData = prevOnData;
    }
  }, 30000);
}

function getNextDeskIndex(): number {
  const sessions = getAllSessions();
  const usedIndices = new Set(sessions.map(s => s.deskIndex));
  for (let i = 0; i < DESK_POSITIONS.length + OVERFLOW_POSITIONS.length; i++) {
    if (!usedIndices.has(i)) return i;
  }
  return sessions.length;
}

function createSessionEntry(id: string, name: string, cwd: string): SessionData {
  const deskIndex = getNextDeskIndex();
  const isDesk = deskIndex < DESK_POSITIONS.length;
  const deskPosition = isDesk
    ? DESK_POSITIONS[deskIndex]
    : deskIndex < DESK_POSITIONS.length + OVERFLOW_POSITIONS.length
      ? OVERFLOW_POSITIONS[deskIndex - DESK_POSITIONS.length]
      : ENTRANCE_POINT;
  const colorIndex = getAllSessions().length % CHARACTER_COLORS.length;

  return {
    id,
    name,
    color: CHARACTER_COLORS[colorIndex],
    status: 'idle' as const,
    deskIndex,
    deskPosition,
    spawnPosition: ENTRANCE_POINT,
    recentActions: [],
    agents: [],
    cwd,
    createdAt: Date.now(),
  };
}

export function setupTerminalBridge(io: SocketIOServer, ptyManager: PtyManager): void {
  io.on('connection', (socket) => {

    // Launch a brand new CLI session (Claude or Copilot)
    socket.on('terminal:new', (opts: {
      cwd: string;
      name?: string;
      permissionMode?: string;
      model?: string;
      effort?: string;
      allowedTools?: string;
      systemPrompt?: string;
      cliType?: 'claude' | 'copilot';
      copilotMode?: string;
    }) => {
      const sessionUuid = randomUUID();
      const cliType = opts.cliType || 'claude';
      const name = opts.name || `session-${Date.now().toString(36)}`;
      try {
        console.log(`[terminal:new] cli=${cliType} name=${name} uuid=${sessionUuid.slice(0, 8)} cwd=${opts.cwd}`);

        const sessionData = createSessionEntry(sessionUuid, name, opts.cwd);
        sessionData.cliType = cliType;
        addSession(sessionData);
        setCachedName(sessionUuid, name);
        io.emit(SOCKET_EVENTS.SESSION_START, sessionData);

        ptyManager.spawnNew(sessionUuid, {
          cwd: opts.cwd,
          sessionUuid,
          name: opts.name,
          permissionMode: opts.permissionMode,
          model: opts.model,
          effort: opts.effort,
          allowedTools: opts.allowedTools,
          systemPrompt: opts.systemPrompt,
          cliType,
          copilotMode: opts.copilotMode,
        });

        ptyManager.onOutput(sessionUuid, (data) => {
          socket.emit('terminal:data', { sessionId: sessionUuid, data });
        });

        // Wire up callbacks
        const newPty = ptyManager.getSession(sessionUuid);
        if (newPty) {
          newPty.onStateChange = (info) => {
            io.emit('session:state', { sessionId: sessionUuid, ...info });
          };
          newPty.onContextUpdate = (usage) => {
            io.emit('session:context', { sessionId: sessionUuid, usage });
          };
        }

        // Auto-accept trust/permission prompts (both Claude and Copilot)
        watchForTrustPrompt(ptyManager, sessionUuid, name);

        // Track for auto-resume
        const active = getActiveSessions().filter(s => s.id !== sessionUuid);
        active.push({ id: sessionUuid, name, cwd: opts.cwd, cliType });
        saveActiveSessions(active);

        socket.emit('terminal:spawned', { sessionId: sessionUuid, name });
      } catch (err) {
        console.error('[terminal:new]', err);
        // Clean up the session that was added before the failed spawn
        removeSession(sessionUuid);
        saveActiveSessions(getActiveSessions().filter(s => s.id !== sessionUuid));
        io.emit(SOCKET_EVENTS.SESSION_END, { sessionId: sessionUuid });
        socket.emit('terminal:spawn-error', { sessionId: sessionUuid, error: String(err) });
      }
    });

    // Fork an existing session — creates a new session branching from the source
    socket.on('terminal:fork', (opts: { sourceSessionId: string; name?: string }) => {
      try {
        const sessionUuid = randomUUID();
        const sourceSession = getSession(opts.sourceSessionId);
        const cwd = sourceSession?.cwd || homedir();
        const name = opts.name || `Fork-${opts.sourceSessionId.slice(0, 8)}`;
        console.log(`[terminal:fork] source=${opts.sourceSessionId.slice(0, 12)} newId=${sessionUuid.slice(0, 8)} cwd=${cwd}`);

        // Create session entry so sprite appears (same pattern as terminal:new)
        const sessionData = createSessionEntry(sessionUuid, name, cwd);
        addSession(sessionData);
        setCachedName(sessionUuid, name);
        io.emit(SOCKET_EVENTS.SESSION_START, sessionData);

        // Fork via resume --fork-session (same pattern as terminal:resume but with fork flag)
        ptyManager.spawnResume(sessionUuid, {
          cwd,
          resumeId: opts.sourceSessionId,
          fork: true,
          cliType: sourceSession?.cliType,
        });

        // Wire up output (same pattern as terminal:new)
        ptyManager.onOutput(sessionUuid, (data) => {
          socket.emit('terminal:data', { sessionId: sessionUuid, data });
        });

        const newPty = ptyManager.getSession(sessionUuid);
        if (newPty) {
          newPty.onStateChange = (info) => {
            io.emit('session:state', { sessionId: sessionUuid, ...info });
          };
          newPty.onContextUpdate = (usage) => {
            io.emit('session:context', { sessionId: sessionUuid, usage });
          };
        }

        // Track for auto-resume
        const active = getActiveSessions().filter(s => s.id !== sessionUuid);
        active.push({ id: sessionUuid, name, cwd, cliType: sourceSession?.cliType });
        saveActiveSessions(active);

        socket.emit('terminal:forked', { sessionId: sessionUuid, sourceSessionId: opts.sourceSessionId, name });
      } catch (err) {
        console.error('[terminal:fork] ERROR:', err);
        socket.emit('terminal:fork-error', { error: String(err) });
      }
    });

    // Resume a past session by ID
    socket.on('terminal:resume', ({ sessionId }: { sessionId: string }) => {
      try {
        console.log(`[terminal:resume] sessionId=${sessionId.slice(0, 12)} hasPty=${ptyManager.hasPty(sessionId)}`);
        if (ptyManager.hasPty(sessionId)) {
          const existingPty = ptyManager.getSession(sessionId);
          // Replay buffered output so terminal isn't blank
          if (existingPty && existingPty.outputBuffer.length > 0) {
            const replay = existingPty.outputBuffer.join('');
            socket.emit('terminal:data', { sessionId, data: replay });
          }
          ptyManager.onOutput(sessionId, (data) => {
            socket.emit('terminal:data', { sessionId, data });
          });
          // Ensure callbacks are set (might be missing from auto-resume)
          if (existingPty) {
            if (!existingPty.onStateChange) {
              existingPty.onStateChange = (info) => io.emit('session:state', { sessionId, ...info });
            }
            if (!existingPty.onContextUpdate) {
              existingPty.onContextUpdate = (usage) => {
                io.emit('session:context', { sessionId, usage });
              };
            }
          }
          return;
        }

        // Orchestrator — just attach output, don't create session/sprite/auto-resume
        if (isOrchestrator(sessionId)) {
          if (!ptyManager.hasPty(sessionId)) return;
          ptyManager.onOutput(sessionId, (data) => {
            socket.emit('terminal:data', { sessionId, data });
          });
          return;
        }

        const { getCachedName: getName } = require('../lib/state/nameCache');
        const existing = getSession(sessionId);
        const name = existing?.name || getName(sessionId) || `Session-${sessionId.slice(0, 8)}`;
        const foundCwd = ptyManager.findSessionCwd(sessionId);
        const cwd = existing?.cwd || foundCwd || homedir();

        // Create session entry so sprite appears
        if (!existing) {
          const sessionData = createSessionEntry(sessionId, name, cwd);
          addSession(sessionData);
          io.emit(SOCKET_EVENTS.SESSION_START, sessionData);
        }

        console.log(`[terminal:resume] ${name} (${sessionId.slice(0, 8)})`);

        // Track for auto-resume
        const active = getActiveSessions().filter(s => s.id !== sessionId);
        active.push({ id: sessionId, name, cwd, cliType: existing?.cliType });
        saveActiveSessions(active);

        ptyManager.spawnResume(sessionId, { cwd, resumeId: sessionId, cliType: existing?.cliType });

        ptyManager.onOutput(sessionId, (data) => {
          socket.emit('terminal:data', { sessionId, data });
        });

        const rPty = ptyManager.getSession(sessionId);
        if (rPty) {
          rPty.onStateChange = (info) => {
            io.emit('session:state', { sessionId, ...info });
          };
          rPty.onContextUpdate = (usage) => {
            io.emit('session:context', { sessionId, usage });
          };
          // Summary generation handled by auto-resume in main.ts or manual refresh
        }
      } catch (err) {
        console.error('[terminal:resume]', err);
      }
    });

    // End a session — fire animation, then /exit, then cleanup
    socket.on('terminal:end', ({ sessionId }: { sessionId: string }) => {
      try {
        // Remove from auto-resume list
        saveActiveSessions(getActiveSessions().filter(s => s.id !== sessionId));

        // Trigger fired animation FIRST
        io.emit('session:fired', { sessionId });

        // Send /exit to PTY after a small delay (let animation start)
        setTimeout(() => {
          if (ptyManager.hasPty(sessionId)) {
            const ptySession = ptyManager.getSession(sessionId);
            if (ptySession) ptySession.pty.write('/exit\r');
          }
        }, 500);

        // Clean up after animation finishes
        setTimeout(() => {
          ptyManager.kill(sessionId);
          removeSession(sessionId);
          io.emit(SOCKET_EVENTS.SESSION_END, { sessionId });
        }, 8000); // shocked(1s) + packing(1.5s) + walk to exit(~4s) + buffer
      } catch (err) {
        console.error('[terminal:end]', err);
      }
    });

    // Forward keystrokes
    socket.on('terminal:input', ({ sessionId, data }: { sessionId: string; data: string }) => {
      const ptySession = ptyManager.getSession(sessionId);
      if (ptySession && ptySession.status !== 'closed') {
        ptySession.pty.write(data);
      }
    });

    // Handle resize
    socket.on('terminal:resize', ({ sessionId, cols, rows }: { sessionId: string; cols: number; rows: number }) => {
      const ptySession = ptyManager.getSession(sessionId);
      if (ptySession && ptySession.status !== 'closed') {
        ptySession.pty.resize(cols, rows);
      }
    });

    // Generate work summary from session (manual refresh)
    socket.on('session:summary', async ({ sessionId }: { sessionId: string }) => {
      const bullets = await requestSummary(io, ptyManager, sessionId);
      socket.emit('session:summary-result', { sessionId, bullets });
    });

    // Reset orchestrator
    socket.on('orchestrator:reset', () => {
      resetOrchestrator();
      const id = getOrchestratorId();
      if (id) socket.emit('orchestrator:id', { sessionId: id });
      console.log('[orchestrator] reset, new id:', id?.slice(0, 12));
    });

    // Send orchestrator ID on request
    socket.on('orchestrator:get-id', () => {
      const id = getOrchestratorId();
      if (id) socket.emit('orchestrator:id', { sessionId: id });
    });

    // Context handoff — generate summary from source, spawn new session, inject handoff
    socket.on('session:handoff', async (data: {
      sourceSessionId: string;
      contextRequest: string;
      targetCwd: string;
      handoffId: string;
      sessionName?: string;
      permissionMode?: string;
      model?: string;
      effort?: string;
      systemPrompt?: string;
    }) => {
      const { sourceSessionId, contextRequest, targetCwd, handoffId } = data;

      // Step 1: Generate summary from source session
      socket.emit('session:handoff-status', { handoffId, status: 'summarizing' });
      const result = await generateHandoffSummary(ptyManager, sourceSessionId, contextRequest, handoffId);

      if (!result.success) {
        socket.emit('session:handoff-status', { handoffId, status: 'error', error: result.error });
        return;
      }

      // Step 2: Spawn new session
      socket.emit('session:handoff-status', { handoffId, status: 'spawning' });
      const { randomUUID } = require('crypto');
      const sessionUuid = randomUUID();
      const name = data.sessionName || `handoff-${handoffId}`;
      const { setCachedName } = require('../lib/state/nameCache');

      const sessionData = createSessionEntry(sessionUuid, name, targetCwd);
      addSession(sessionData);
      setCachedName(sessionUuid, name);
      io.emit(SOCKET_EVENTS.SESSION_START, sessionData);

      ptyManager.spawnNew(sessionUuid, {
        cwd: targetCwd,
        sessionUuid,
        permissionMode: data.permissionMode || 'bypassPermissions',
        model: data.model,
        effort: data.effort,
        systemPrompt: data.systemPrompt,
      });

      ptyManager.onOutput(sessionUuid, (outData) => {
        socket.emit('terminal:data', { sessionId: sessionUuid, data: outData });
      });

      // Auto-accept trust prompts for handoff sessions too
      watchForTrustPrompt(ptyManager, sessionUuid, name);

      const newPty = ptyManager.getSession(sessionUuid);
      if (newPty) {
        newPty.onStateChange = (info) => io.emit('session:state', { sessionId: sessionUuid, ...info });
        newPty.onContextUpdate = (usage) => io.emit('session:context', { sessionId: sessionUuid, usage });

        // Step 3: Wait for ready, then inject handoff
        socket.emit('session:handoff-status', { handoffId, status: 'injecting' });
        // Use fixed delay since onReady may not fire reliably
        setTimeout(() => {
          injectHandoffIntoSession(ptyManager, sessionUuid, handoffId);
          socket.emit('session:handoff-status', {
            handoffId,
            status: 'done',
            newSessionId: sessionUuid,
          });
        }, 8000);
      } else {
        socket.emit('session:handoff-status', { handoffId, status: 'error', error: 'Failed to spawn session' });
      }

      // Track for auto-resume
      const active = getActiveSessions().filter(s => s.id !== sessionUuid);
      active.push({ id: sessionUuid, name, cwd: targetCwd });
      saveActiveSessions(active);

      socket.emit('terminal:spawned', { sessionId: sessionUuid, name });
    });

    // Query the orchestrator
    socket.on('orchestrator:query', async ({ query, queryId }: { query: string; queryId: string }) => {
      const result = await queryOrchestrator(query);
      socket.emit('orchestrator:result', { queryId, ...result });
    });

    // ─── Editor shell terminals (raw shell, no Claude) ───

    socket.on('editor:terminal:spawn', ({ id, cwd, cols, rows }: { id: string; cwd: string; cols?: number; rows?: number }) => {
      try {
        const pty = require('node-pty');
        const { existsSync } = require('fs');
        const safeCwd = existsSync(cwd) ? cwd : homedir();
        const shell = process.platform === 'win32'
          ? 'cmd.exe'
          : (process.env.SHELL || '/bin/zsh');

        // Clean env: remove Electron/npm vars that break nvm and shell behavior
        const env: Record<string, string> = {};
        for (const [k, v] of Object.entries(process.env)) {
          if (!v) continue;
          if (k.startsWith('npm_')) continue;
          if (k === 'NODE_ENV' || k === 'ELECTRON_RUN_AS_NODE' || k === 'ELECTRON_NO_ASAR') continue;
          env[k] = v;
        }
        env.TERM = 'xterm-256color';
        const spawnCols = cols || 120;
        const spawnRows = rows || 24;
        env.COLUMNS = String(spawnCols);
        env.LINES = String(spawnRows);

        // Spawn like VS Code does on macOS: use `login` for proper env, or direct shell on other platforms
        let spawnCmd = shell;
        let args: string[] = ['-i'];
        if (process.platform === 'darwin') {
          spawnCmd = '/usr/bin/login';
          args = ['-fp', env.USER || env.LOGNAME || 'user'];
        } else if (process.platform !== 'win32') {
          args = ['-l', '-i'];
        } else {
          args = [];
        }
        const proc = pty.spawn(spawnCmd, args, {
          cwd: safeCwd,
          cols: spawnCols,
          rows: spawnRows,
          env,
        });

        // Store in a map on globalThis for lifecycle management
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
      const entry = terminals?.get(id);
      if (entry) entry.proc.write(data);
    });

    socket.on('editor:terminal:resize', ({ id, cols, rows }: { id: string; cols: number; rows: number }) => {
      const g = globalThis as Record<string, unknown>;
      const terminals = g.__editorTerminals as Map<string, { proc: any; buffer: string[] }> | undefined;
      const entry = terminals?.get(id);
      if (entry) entry.proc.resize(cols, rows);
    });

    socket.on('editor:terminal:kill', ({ id }: { id: string }) => {
      const g = globalThis as Record<string, unknown>;
      const terminals = g.__editorTerminals as Map<string, { proc: any; buffer: string[] }> | undefined;
      const entry = terminals?.get(id);
      if (entry) {
        entry.proc.kill();
        terminals!.delete(id);
      }
    });

    // Replay buffer on reconnect
    socket.on('editor:terminal:attach', ({ id }: { id: string }) => {
      const g = globalThis as Record<string, unknown>;
      const terminals = g.__editorTerminals as Map<string, { proc: any; buffer: string[] }> | undefined;
      const entry = terminals?.get(id);
      if (entry && entry.buffer.length > 0) {
        socket.emit('editor:terminal:data', { id, data: entry.buffer.join('') });
      }
    });
  });
}
