import type { Server as SocketIOServer } from 'socket.io';
import { PtyManager } from './pty/PtyManager';
import { randomUUID } from 'crypto';
import { homedir } from 'os';
import { addSession, getAllSessions, getSession, removeSession, updateSession } from '../lib/state/sessionStore';
import { getCachedName, setCachedName } from '../lib/state/nameCache';
import { getActiveSessions, saveActiveSessions, setActiveSessionName } from '../lib/state/activeSessionsCache';
import { SOCKET_EVENTS } from '../lib/types';
import type { ResumeSessionRequest, SessionData } from '../lib/types';
import {
  DESK_POSITIONS, OVERFLOW_POSITIONS, ENTRANCE_POINT, CHARACTER_COLORS,
} from '../lib/constants';
import { requestSummary } from './services/SummaryService';
import { queryOrchestrator, getOrchestratorId, isOrchestrator, resetOrchestrator } from './services/OrchestratorService';
import { generateHandoffSummary, injectHandoffIntoSession } from './services/HandoffService';
import { OutputParser } from './pty/OutputParser';
import { reapOrphansForSessions, logReapResult } from './services/OrphanReaper';
import type { PtySession } from './pty/PtyManager';
import { getProvider } from '../lib/cli';
import type { CliType } from '../lib/types';
export { requestSummary };

/**
 * Watch newly spawned session output for trust/permission prompts and
 * auto-accept them. Trust-prompt phrasing is provider-owned via
 * `provider.getTrustPromptPatterns()`.
 */
function watchForTrustPrompt(ptyManager: PtyManager, sessionId: string, sessionName: string): void {
  const ptySession = ptyManager.getSession(sessionId);
  if (!ptySession) return;

  const provider = getProvider((ptySession.cliType as CliType) || 'claude');
  const patterns = provider.getTrustPromptPatterns();
  if (patterns.length === 0) return;

  let buffer = '';
  let done = false;

  const monitor = (data: string) => {
    if (done) return;

    buffer += data;
    const clean = OutputParser.stripAnsi(buffer);

    if (patterns.some(p => clean.includes(p))) {
      console.log(`[trust-prompt] ${sessionName}: detected trust prompt, auto-accepting...`);
      setTimeout(() => { try { ptySession.pty.write('\r'); } catch { /* PTY may have exited */ } }, 300);
      setTimeout(() => { done = true; ptySession.subscribers.delete(monitor); }, 2000);
      return;
    }

    if (buffer.length > 10000) buffer = buffer.slice(-5000);
  };

  ptySession.subscribers.add(monitor);

  setTimeout(() => {
    if (!done) { done = true; ptySession.subscribers.delete(monitor); }
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

function createSessionEntry(id: string, name: string, cwd: string, cliType?: CliType): SessionData {
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
    cliType,
  };
}

function discoveredSessionName(cliType: CliType | undefined, sessionId: string): string | undefined {
  if (!cliType) return undefined;
  try {
    let latest: { name?: string; lastModified?: number } | undefined;
    for (const session of getProvider(cliType).discoverSessions()) {
      if (session.id !== sessionId) continue;
      if (!latest || (session.lastModified ?? 0) > (latest.lastModified ?? 0)) latest = session;
    }
    return latest?.name;
  } catch {
    return undefined;
  }
}

export function setupTerminalBridge(io: SocketIOServer, ptyManager: PtyManager): void {
  // Sessions currently mid-teardown (terminal:end fired, animation + kill
  // pending). Shared across sockets. While a session is here, terminal:resume
  // is refused so an accidental click during the ~8s close animation can't
  // reconnect or (worse) respawn a fresh CLI process for a dying session.
  const endingSessions = new Set<string>();

  io.on('connection', (socket) => {

    // Track this socket's PTY output subscriptions so wiring is idempotent:
    // re-subscribing (remount / reconnect / repeated resume) replaces the
    // prior subscription for the same session instead of stacking duplicate
    // emits, and everything is torn down on disconnect so we don't leak
    // subscribers on the (now Set-based) PtySession.
    const outputSubs = new Map<string, () => void>();
    const subscribeOutput = (sessionId: string): void => {
      outputSubs.get(sessionId)?.();
      outputSubs.set(sessionId, ptyManager.onOutput(sessionId, (data) => {
        socket.emit('terminal:data', { sessionId, data });
      }));
    };
    socket.on('disconnect', () => {
      for (const unsub of outputSubs.values()) unsub();
      outputSubs.clear();
    });

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

        const sessionData = createSessionEntry(sessionUuid, name, opts.cwd, cliType);
        addSession(sessionData);
        setCachedName(sessionUuid, name);
        io.emit(SOCKET_EVENTS.SESSION_START, sessionData);

        ptyManager.spawnNew(sessionUuid, {
          cwd: opts.cwd,
          sessionUuid,
          name,
          permissionMode: opts.permissionMode,
          model: opts.model,
          effort: opts.effort,
          allowedTools: opts.allowedTools,
          systemPrompt: opts.systemPrompt,
          cliType,
          copilotMode: opts.copilotMode,
        });

        subscribeOutput(sessionUuid);

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
        const sessionData = createSessionEntry(sessionUuid, name, cwd, sourceSession?.cliType);
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
        subscribeOutput(sessionUuid);

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
    socket.on('terminal:resume', ({
      sessionId,
      name: requestedNameValue,
      cliType: requestedCliType,
    }: ResumeSessionRequest) => {
      try {
        const requestedName = typeof requestedNameValue === 'string'
          ? requestedNameValue.trim().replace(/\s+/g, ' ').slice(0, 120) || undefined
          : undefined;
        const tracked = getSession(sessionId);
        if (requestedName) {
          setCachedName(sessionId, requestedName);
          setActiveSessionName(sessionId, requestedName);
          if (tracked && tracked.name !== requestedName) {
            updateSession(sessionId, { name: requestedName });
            io.emit(SOCKET_EVENTS.SESSION_UPDATE, {
              sessionId,
              changes: { name: requestedName },
            });
          }
        }

        // Refuse to resume a session that's mid-teardown. Without this, a
        // click on the sprite during the close animation reconnects (warm
        // path) or reaps+respawns a new CLI process (cold path), resurrecting
        // a session the user just quit.
        if (endingSessions.has(sessionId)) {
          console.log(`[terminal:resume] ignored — ${sessionId.slice(0, 12)} is ending`);
          return;
        }
        console.log(`[terminal:resume] sessionId=${sessionId.slice(0, 12)} hasPty=${ptyManager.hasPty(sessionId)}`);
        if (ptyManager.hasPty(sessionId)) {
          const existingPty = ptyManager.getSession(sessionId);
          // Wire live output BEFORE deciding how to seed the screen so we
          // don't miss any data that arrives between replay and onOutput hookup.
          subscribeOutput(sessionId);
          // Seed the screen. Two strategies depending on the CLI:
          //
          // - Claude: replay the cached output buffer. Claude's TUI tolerates
          //   re-emitting old content into new dimensions because its redraw
          //   uses screen-relative clears that re-anchor naturally.
          //
          // - Copilot: a full-screen alt-screen TUI that paints with absolute
          //   cursor positioning, so replaying stale-dims chunks corrupts the
          //   frame. Instead force a fresh repaint by nudging the PTY size,
          //   which makes Copilot redraw the current frame at the live dims via
          //   SIGWINCH. We subscribed this client above first, so the redraw
          //   reaches it — even for an idle session with no buffered output.
          //   Never Ctrl+L (that clears the screen).
          if (existingPty?.cliType === 'copilot') {
            setTimeout(() => ptyManager.forceRepaint(sessionId), 75);
          } else if (existingPty && existingPty.outputBuffer.length > 0) {
            const replay = existingPty.outputBuffer.join('');
            socket.emit('terminal:data', { sessionId, data: replay });
          }
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
          subscribeOutput(sessionId);
          return;
        }

        const existing = getSession(sessionId);
        // Resolve which CLI owns this session. Prefer the caller's explicit
        // hint (the Resume modal knows it from discovery), then any tracked
        // entry, then probe disk (Copilot session-state vs Claude projects).
        // Without this, a cold resume falls through to spawnResume's 'claude'
        // default and Copilot sessions would wrongly resume as Claude.
        const resolvedCliType: CliType | undefined =
          requestedCliType || existing?.cliType ||
          (ptyManager.findSessionCwd(sessionId, 'copilot') ? 'copilot'
            : ptyManager.findSessionCwd(sessionId, 'claude') ? 'claude'
            : undefined);
        const name = requestedName
          || discoveredSessionName(resolvedCliType, sessionId)
          || existing?.name
          || getCachedName(sessionId)
          || `Session-${sessionId.slice(0, 8)}`;
        const foundCwd = ptyManager.findSessionCwd(sessionId, resolvedCliType);
        const cwd = existing?.cwd || foundCwd || homedir();

        // Create session entry so sprite appears
        if (!existing) {
          const sessionData = createSessionEntry(sessionId, name, cwd, resolvedCliType);
          addSession(sessionData);
          io.emit(SOCKET_EVENTS.SESSION_START, sessionData);
        } else if (existing.name !== name) {
          updateSession(sessionId, { name });
          io.emit(SOCKET_EVENTS.SESSION_UPDATE, { sessionId, changes: { name } });
        }
        setCachedName(sessionId, name);

        console.log(`[terminal:resume] ${name} (${sessionId.slice(0, 8)})`);

        // Track for auto-resume
        const active = getActiveSessions().filter(s => s.id !== sessionId);
        active.push({ id: sessionId, name, cwd, cliType: resolvedCliType });
        saveActiveSessions(active);

        // Guard against running an already-running session. Copilot does NOT
        // refuse a second concurrent resume of the same UUID — it spawns a
        // PHANTOM session instead (verified). So before spawning, reap any
        // live process still holding THIS session id (and clean its stale
        // Copilot inuse.<PID>.lock). Targeted to this id only, so unrelated
        // sessions the user is running elsewhere are left alone. Our own live
        // PTY is already handled by the hasPty() warm path above.
        const reaped = reapOrphansForSessions([sessionId]);
        if (reaped.killed > 0) logReapResult(`resume ${name}`, reaped);

        ptyManager.spawnResume(sessionId, { cwd, resumeId: sessionId, cliType: resolvedCliType });

        subscribeOutput(sessionId);

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
        // Mark as ending so terminal:resume refuses to reconnect/respawn it
        // during the close animation window (guards the click-while-closing
        // race).
        endingSessions.add(sessionId);

        // Remove from auto-resume list
        saveActiveSessions(getActiveSessions().filter(s => s.id !== sessionId));

        // Trigger fired animation FIRST
        io.emit('session:fired', { sessionId });

        // Send the provider-specific clean-exit keystrokes after a small
        // delay (let the fired animation start). Claude: /exit; Copilot:
        // Ctrl-C x2. The kill below is the backstop if the CLI ignores them.
        setTimeout(() => {
          if (ptyManager.hasPty(sessionId)) {
            void ptyManager.sendExitSequence(sessionId);
          }
        }, 500);

        // Clean up after animation finishes
        setTimeout(() => {
          ptyManager.kill(sessionId);
          removeSession(sessionId);
          io.emit(SOCKET_EVENTS.SESSION_END, { sessionId });
          endingSessions.delete(sessionId);
        }, 8000); // shocked(1s) + packing(1.5s) + walk to exit(~4s) + buffer
      } catch (err) {
        console.error('[terminal:end]', err);
        endingSessions.delete(sessionId);
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
        if (process.env.AGENTMATRIX_DEBUG_PTY === '1') {
          console.log(`[pty:resize] id=${sessionId.slice(0, 12)} cli=${ptySession.cliType} cols=${cols} rows=${rows}`);
        }
        ptySession.cols = cols;
        ptySession.rows = rows;
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

      subscribeOutput(sessionUuid);

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
