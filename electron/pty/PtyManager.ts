import { homedir } from 'os';
import { existsSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import type { IPty } from 'node-pty';
import { OutputParser, type PtyState, type StateInfo } from './OutputParser';
import type { CliProvider, CliType } from '../../lib/cli/CliProvider';
import {
  clearNavigationCapability,
  issueNavigationCapability,
  type NavigationCapability,
} from '../../lib/navigation/rootRegistry';
import { buildAgentMatrixCopilotMcpConfig } from '../services/mcpConfig';
import { prependManagedNpmPolicy } from '../services/npmPolicy';
import {
  createTerminalProtocolState,
  terminalProtocolReplaySequence,
  updateTerminalProtocolState,
  type TerminalProtocolState,
} from '../../lib/terminal-protocol';

// Opt-in raw PTY stream tee — set AGENTMATRIX_DEBUG_PTY=1 to dump every
// chunk to ~/.agentmatrix/debug/<sessionId>.bin. Used to diagnose TUI
// fitting/repaint bugs by replaying the exact byte stream later.
const DEBUG_PTY = process.env.AGENTMATRIX_DEBUG_PTY === '1';
const DEBUG_DIR = join(homedir(), '.agentmatrix', 'debug');
if (DEBUG_PTY) {
  try { if (!existsSync(DEBUG_DIR)) mkdirSync(DEBUG_DIR, { recursive: true }); } catch { /* ignore */ }
  console.log(`[pty:debug] raw stream tee enabled → ${DEBUG_DIR}/<sessionId>.bin`);
}

// Opt-in PTY-path perf telemetry — set AM_PERF=1. Aggregates the per-chunk
// processing cost (subscriber fan-out + context parse + prompt detection) in
// the electron main process and logs a summary every few seconds. Useful for
// spotting whether fast-streaming terminal output is starving the main thread
// (a common Windows sluggishness cause). No-op unless AM_PERF=1.
const PERF = process.env.AM_PERF === '1';
const PERF_FLUSH_MS = 3000;
let perfChunks = 0;
let perfBytes = 0;
let perfProcMs = 0;
let perfWorstMs = 0;
if (PERF) {
  console.log('[pty:perf] enabled — per-chunk processing summaries every 3s (set AM_PERF=0 to disable)');
  setInterval(() => {
    if (perfChunks === 0) return;
    const kb = (perfBytes / 1024).toFixed(0);
    const rate = (perfChunks / (PERF_FLUSH_MS / 1000)).toFixed(0);
    console.log(`[pty:perf] chunks=${perfChunks} (${rate}/s) bytes=${kb}KB proc=${perfProcMs.toFixed(0)}ms worst=${perfWorstMs.toFixed(1)}ms`);
    perfChunks = 0; perfBytes = 0; perfProcMs = 0; perfWorstMs = 0;
  }, PERF_FLUSH_MS).unref?.();
}

export interface PtySession {
  id: string;
  pty: IPty;
  cliType: CliType;
  status: 'starting' | 'ready' | 'busy' | 'closed';
  currentState: PtyState;
  contextUsage: number | null; // % used (0-100)
  outputBuffer: string[];
  terminalProtocolState: TerminalProtocolState;
  cols: number;
  rows: number;
  subscribers: Set<(data: string) => void>;
  onReady: (() => void) | null;
  onStateChange: ((info: StateInfo) => void) | null;
  onContextUpdate: ((usage: number) => void) | null;
  pendingPrompt: string | null;
}

export class PtyManager {
  private sessions = new Map<string, PtySession>();
  private providers = new Map<CliType, CliProvider>();
  private defaultProvider!: CliProvider;

  constructor(providers?: Map<CliType, CliProvider>) {
    if (providers) {
      this.providers = providers;
      // Default to first provider (should be claude)
      this.defaultProvider = providers.values().next().value!;
    } else {
      // Lazy-load providers — always register both so cliType routing works
      // even if the binary isn't on PATH (Agency may manage it)
      try {
        const { getProvider, getDefaultProvider } = require('../../lib/cli');
        const claude = getProvider('claude') as CliProvider;
        this.providers.set('claude', claude);
        const copilot = getProvider('copilot') as CliProvider;
        this.providers.set('copilot', copilot);
        this.defaultProvider = getDefaultProvider() as CliProvider;
      } catch (err) {
        console.warn('[PtyManager] Provider loading failed, using fallback:', err);
        // Fallback: create providers directly
        try {
          const { ClaudeProvider } = require('../../lib/cli/ClaudeProvider');
          const claude = new ClaudeProvider();
          this.providers.set('claude', claude);
          this.defaultProvider = claude;
        } catch {}
        try {
          const { CopilotProvider } = require('../../lib/cli/CopilotProvider');
          this.providers.set('copilot', new CopilotProvider());
        } catch {}
        if (!this.defaultProvider) {
          throw new Error('No CLI providers could be loaded');
        }
      }
    }
  }

  private getProviderForType(cliType?: CliType): CliProvider {
    if (cliType && this.providers.has(cliType)) {
      return this.providers.get(cliType)!;
    }
    if (cliType) {
      console.error(`[PtyManager] WARNING: requested provider '${cliType}' not found! Falling back to '${this.defaultProvider.type}'. Available: [${[...this.providers.keys()].join(', ')}]`);
    }
    return this.defaultProvider;
  }

  /**
   * Resolve the original working directory for a session ID. Delegates
   * to the right provider's `findSessionCwd` since each CLI has its own
   * on-disk layout. If `cliType` is unknown, probes both providers.
   *
   * COST: provider-dependent. Claude scans its project dirs and reads a
   * partial transcript header; Copilot opens one workspace.yaml.
   */
  findSessionCwd(sessionId: string, cliType?: CliType): string | undefined {
    if (cliType) {
      try {
        return this.getProviderForType(cliType).findSessionCwd(sessionId);
      } catch {
        return undefined;
      }
    }
    for (const p of [this.getProviderForType('claude'), this.getProviderForType('copilot')]) {
      try {
        const cwd = p.findSessionCwd(sessionId);
        if (cwd) return cwd;
      } catch { /* try next */ }
    }
    return undefined;
  }

  private createPtySession(id: string, ptyProcess: IPty, cliType: CliType): PtySession {
    const provider = this.getProviderForType(cliType);
    const session: PtySession = {
      id, pty: ptyProcess, cliType, status: 'starting',
      currentState: 'busy', contextUsage: null,
      outputBuffer: [],
      terminalProtocolState: createTerminalProtocolState(),
      cols: 80, rows: 24,
      subscribers: new Set(), onReady: null, onStateChange: null, onContextUpdate: null,
      pendingPrompt: null,
    };

    ptyProcess.onData((data: string) => {
      const perfT0 = PERF ? performance.now() : 0;
      session.terminalProtocolState = updateTerminalProtocolState(
        session.terminalProtocolState,
        data,
      );
      session.outputBuffer.push(data);
      if (session.outputBuffer.length > 500) session.outputBuffer = session.outputBuffer.slice(-300);
      // Fan out to every live subscriber (socket emit, trust/context monitors,
      // etc.). A single mutable callback used to clobber whichever consumer
      // registered last; a Set lets them coexist.
      for (const sub of session.subscribers) {
        try { sub(data); } catch (err) { console.error(`[pty:sub] ${id.slice(0, 8)}`, err); }
      }
      if (DEBUG_PTY) {
        try { appendFileSync(join(DEBUG_DIR, `${id}.bin`), data); } catch { /* ignore */ }
      }

      // Parse context usage — check single chunk AND recent buffer
      // Delegate to the provider for CLI-specific parsing
      const recent = session.outputBuffer.slice(-3).join('');
      const ctx = provider.parseContextUsage(data) ?? provider.parseContextUsage(recent);
      if (ctx !== null && ctx !== session.contextUsage) {
        session.contextUsage = ctx;
        if (session.onContextUpdate) session.onContextUpdate(ctx);
      }

      const prev = session.currentState;
      const recentForReady = session.outputBuffer.slice(-3).join('');

      // Delegate prompt detection to the provider
      if (provider.detectPromptReady(recentForReady)) {
        if (prev !== 'ready') {
          session.currentState = 'ready';
          session.status = 'ready';
          if (session.pendingPrompt) {
            const p = session.pendingPrompt;
            session.pendingPrompt = null;
            session.currentState = 'busy';
            session.status = 'busy';
            session.pty.write(p + '\r');
            return;
          }
          if (session.onReady) session.onReady();
          if (session.onStateChange) session.onStateChange({ state: 'ready' });

          // A turn just completed, so the context grew. For CLIs that track
          // usage on disk (Copilot), read the new figure off the main thread
          // and emit it. CLIs that parse usage from the TUI text (Claude)
          // return null here and update via parseContextUsage above.
          void provider.getContextUsage(id).then((ctxPct) => {
            const live = this.sessions.get(id);
            if (!live || ctxPct === null || ctxPct === live.contextUsage) return;
            live.contextUsage = ctxPct;
            if (live.onContextUpdate) live.onContextUpdate(ctxPct);
          }).catch(() => { /* usage unavailable — leave bar as-is */ });
        }
      } else if (prev === 'ready') {
        session.currentState = 'busy';
        session.status = 'busy';
        if (session.onStateChange) session.onStateChange({ state: 'busy' });
      }

      if (PERF) {
        const dt = performance.now() - perfT0;
        perfChunks += 1;
        perfBytes += data.length;
        perfProcMs += dt;
        if (dt > perfWorstMs) perfWorstMs = dt;
      }
    });

    ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      console.log(`[pty:exit] id=${id.slice(0, 12)} code=${exitCode}`);
      session.status = 'closed';
      // A restart can replace this PTY under the same session ID before the
      // old process delivers its delayed exit callback. Never let the old
      // callback delete the replacement session or its navigation capability.
      if (this.sessions.get(id) === session) {
        this.sessions.delete(id);
        clearNavigationCapability(id);
      }
    });

    this.sessions.set(id, session);
    return session;
  }

  private spawnPty(
    cwd: string,
    cliArgs: string[],
    cliType?: CliType,
    navigationIdentity?: NavigationCapability,
  ): IPty {
    const pty = require('node-pty');
    const provider = this.getProviderForType(cliType);
    const { existsSync } = require('fs');
    const cwdExists = existsSync(cwd);
    const safeCwd = cwdExists ? cwd : homedir();
    const env = { ...process.env };
    let effectiveCliArgs = cliArgs;
    delete env.CLAUDECODE;

    // Copilot only delivers hooks to http://localhost when this is set; without
    // it every localhost HTTP hook silently no-fires, so AgentMatrix's dashboard
    // hooks (session/tool/agent activity) never arrive. Harmless for Claude, but
    // scope it to Copilot to be explicit. See docs/design/copilot-hooks-reference.md.
    if (provider.type === 'copilot') {
      prependManagedNpmPolicy(env);
      env.COPILOT_HOOK_ALLOW_LOCALHOST = '1';
      const parsedPort = Number.parseInt(process.env.PORT || '3000', 10);
      const mcpPort = Number.isFinite(parsedPort) ? parsedPort : 3000;
      effectiveCliArgs = [
        ...cliArgs,
        '--additional-mcp-config',
        buildAgentMatrixCopilotMcpConfig(mcpPort),
      ];
    }
    if (navigationIdentity) {
      env.AGENTMATRIX_SESSION_ID = navigationIdentity.sessionId;
      env.AGENTMATRIX_NAVIGATION_CAPABILITY = navigationIdentity.capability;
      env.AGENTMATRIX_REPO_IDENTITY = navigationIdentity.repoIdentity;
    }

    // Check if Agency mode is enabled
    const { getSettings } = require('../../lib/state/appSettings');
    const useAgency = getSettings().useAgency === true;

    let spawnBinary: string;
    let spawnArgs: string[];

    if (useAgency) {
      // Agency wraps the CLI: `agency claude <args>` or `agency copilot <args>`
      let agencyFound = false;
      try {
        const cmd = process.platform === 'win32' ? 'where agency' : 'which agency';
        const { execSync } = require('child_process');
        spawnBinary = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim().split('\n')[0];
        spawnArgs = [provider.type, ...effectiveCliArgs];
        agencyFound = true;
      } catch {
        // Agency not found — try direct binary, but give a clear error if that also fails
        console.warn(`[spawnPty] Agency enabled but 'agency' not found on PATH, trying direct ${provider.type} binary`);
        try {
          spawnBinary = provider.findBinary();
          spawnArgs = effectiveCliArgs;
        } catch {
          throw new Error(`Agency binary not found on PATH and ${provider.type} CLI is not directly installed. Install Agency or the ${provider.displayName} CLI.`);
        }
      }
    } else {
      spawnBinary = provider.findBinary();
      spawnArgs = effectiveCliArgs;
    }

    const label = useAgency ? `agency ${provider.type}` : provider.type;
    console.log(`[spawnPty] ${label} cwd="${safeCwd}" args=${spawnArgs.join(' ')}`);

    // Wrap node-pty spawn so its cryptic native failure becomes actionable.
    // `posix_spawnp failed` (macOS/Linux) means node-pty's native helper
    // (build/Release/spawn-helper + pty.node) is missing, the wrong CPU arch,
    // or not executable for this machine — almost always because node_modules
    // was copied between machines or wasn't rebuilt for Electron.
    const spawnWithHint = (file: string, args: string[]): IPty => {
      try {
        return pty.spawn(file, args, { cwd: safeCwd, cols: 80, rows: 24, env });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/posix_spawnp|spawn.?helper|ENOENT|dlopen|invalid ELF|not.*executable/i.test(msg)) {
          throw new Error(
            `node-pty failed to spawn a process ("${msg}"). Its native module is ` +
            `missing or incompatible with this machine (wrong CPU arch, or ` +
            `node_modules copied from another computer). Rebuild it for this ` +
            `machine's Electron:\n` +
            `  npm run rebuild:native   (alias for: npx electron-rebuild -f -w node-pty)\n` +
            `or reinstall cleanly:\n` +
            `  rm -rf node_modules package-lock.json && npm install && npx electron-rebuild`,
          );
        }
        throw err;
      }
    };

    // Use 80 cols default — CLI TUI renders welcome screen at spawn time.
    // The terminal panel will resize the PTY to match when it opens.
    if (process.platform === 'win32') {
      return spawnWithHint(spawnBinary, spawnArgs);
    }
    const shell = process.env.SHELL || '/bin/bash';
    // Shell-quote every token so args containing spaces or shell metacharacters
    // (e.g. a Copilot `-n "My (test)"` session name) can't break or inject into
    // the `sh -c` command. Single-quote wrapping with '\'' escaping is the
    // POSIX-safe form. This replaces per-provider ad-hoc quoting.
    const shQuote = (s: string) => `'${String(s).replace(/'/g, `'\\''`)}'`;
    const fullCmd = [spawnBinary, ...spawnArgs].map(shQuote).join(' ');
    return spawnWithHint(shell, ['-c', `cd "${safeCwd}" && ${fullCmd}`]);
  }

  spawnNew(id: string, opts: {
    cwd: string; sessionUuid?: string; name?: string;
    permissionMode?: string; model?: string; effort?: string;
    allowedTools?: string; systemPrompt?: string;
    /** Extra readable dirs (context handoff grants the prior transcript's dir). */
    addDirs?: string[];
    cliType?: CliType; copilotMode?: string;
  }): PtySession {
    if (this.sessions.has(id)) throw new Error(`Session ${id} already exists`);

    const cliType = opts.cliType || 'claude';
    const provider = this.getProviderForType(cliType);

    // Inject MCP status instructions only when the CLI supports the
    // MCP-aware system prompt scheme. Copilot's prompt grammar differs;
    // until that's verified, supportsMcp gates this off for Copilot.
    let systemPrompt = opts.systemPrompt;
    if (provider.supportsMcp) {
      const { MCP_SYSTEM_PROMPT: mcpInstructions } = require('../../lib/constants/mcpPrompt');
      systemPrompt = systemPrompt
        ? `${mcpInstructions} ${systemPrompt}`
        : mcpInstructions;
    }

    const args = provider.buildSpawnArgs({
      cwd: opts.cwd,
      sessionId: opts.sessionUuid,
      name: opts.name,
      permissionMode: opts.permissionMode,
      model: opts.model,
      effort: opts.effort,
      allowedTools: opts.allowedTools,
      systemPrompt,
      addDirs: opts.addDirs,
      copilotMode: opts.copilotMode,
    });

    console.log(`[spawnNew] id=${id.slice(0, 8)} requestedCli=${opts.cliType} actualProvider=${provider.type} args=${args.join(' ')}`);
    const navigationIdentity = issueNavigationCapability(id, opts.cwd);
    try {
      return this.createPtySession(id, this.spawnPty(opts.cwd, args, cliType, navigationIdentity), cliType);
    } catch (error) {
      clearNavigationCapability(id);
      throw error;
    }
  }

  spawnResume(id: string, opts: {
    cwd?: string; resumeId: string; fork?: boolean; systemPrompt?: string;
    cliType?: CliType; permissionMode?: string; model?: string; effort?: string;
    allowedTools?: string; copilotMode?: string;
  }): PtySession {
    if (this.sessions.has(id)) throw new Error(`Session ${id} already exists`);

    const cliType = opts.cliType || 'claude';
    const provider = this.getProviderForType(cliType);

    const foundCwd = this.findSessionCwd(opts.resumeId, cliType);
    const cwd = foundCwd ?? opts.cwd ?? homedir();
    console.log(`[spawnResume] id=${id.slice(0, 12)} resumeId=${opts.resumeId.slice(0, 12)} cli=${cliType} foundCwd=${foundCwd} optsCwd=${opts.cwd} finalCwd=${cwd}`);

    const args = provider.buildResumeArgs({
      cwd,
      resumeId: opts.resumeId,
      fork: opts.fork,
      permissionMode: opts.permissionMode,
      model: opts.model,
      effort: opts.effort,
      allowedTools: opts.allowedTools,
      copilotMode: opts.copilotMode,
    });

    // Claude's MCP server instructions are not a CLI launch flag, so append the
    // shared AgentMatrix contract on EVERY resume (including auto-resume/fork).
    // Copilot receives the same contract from MCP initialization instructions
    // via --allow-all-mcp-server-instructions in CopilotProvider.
    let resumeSystemPrompt = opts.systemPrompt;
    if (provider.supportsMcp) {
      const { MCP_SYSTEM_PROMPT: mcpInstructions } = require('../../lib/constants/mcpPrompt');
      resumeSystemPrompt = resumeSystemPrompt
        ? `${mcpInstructions} ${resumeSystemPrompt}`
        : mcpInstructions;
    }
    if (cliType === 'claude' && resumeSystemPrompt) {
      const oneLine = resumeSystemPrompt.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
      args.push('--append-system-prompt', oneLine);
    }

    const navigationIdentity = issueNavigationCapability(id, cwd);
    try {
      return this.createPtySession(id, this.spawnPty(cwd, args, cliType, navigationIdentity), cliType);
    } catch (error) {
      clearNavigationCapability(id);
      throw error;
    }
  }

  sendPrompt(sessionId: string, prompt: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    if (session.status === 'closed') throw new Error(`Session ${sessionId} closed`);
    if (session.status === 'ready') {
      session.status = 'busy';
      session.currentState = 'busy';
      session.pty.write(prompt + '\r');
    } else {
      session.pendingPrompt = prompt;
    }
  }

  onOutput(sessionId: string, callback: (data: string) => void): () => void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    session.subscribers.add(callback);
    return () => { session.subscribers.delete(callback); };
  }

  onReady(sessionId: string, callback: () => void): () => void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    session.onReady = callback;
    if (session.status === 'ready') callback();
    return () => { if (session.onReady === callback) session.onReady = null; };
  }

  kill(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    try { session.pty.kill(); } catch {}
    session.status = 'closed';
    this.sessions.delete(sessionId);
    clearNavigationCapability(sessionId);
  }

  hasPty(sessionId: string): boolean { return this.sessions.has(sessionId); }
  getSession(sessionId: string): PtySession | undefined { return this.sessions.get(sessionId); }
  getAllSessions(): PtySession[] { return Array.from(this.sessions.values()); }
  getTerminalProtocolReplay(sessionId: string): string {
    const session = this.sessions.get(sessionId);
    return session ? terminalProtocolReplaySequence(session.terminalProtocolState) : '';
  }

  /**
   * Force a full-screen TUI (notably Copilot) to repaint its current frame by
   * nudging the PTY size, which triggers a SIGWINCH-driven redraw. Used on
   * reconnect so an alt-screen app repaints into the freshly-attached client
   * without clearing history (never Ctrl+L). No-op if the PTY has exited.
   */
  forceRepaint(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.status === 'closed') return;
    const cols = Math.max(2, session.cols || 80);
    const rows = Math.max(2, session.rows || 24);
    const nudgeCols = cols > 2 ? cols - 1 : cols + 1;
    try {
      session.pty.resize(nudgeCols, rows);
      setTimeout(() => {
        const live = this.sessions.get(sessionId);
        if (!live || live.status === 'closed') return;
        try {
          live.pty.resize(cols, rows);
          live.cols = cols;
          live.rows = rows;
        } catch { /* PTY may have exited */ }
      }, 50);
    } catch { /* PTY may have exited */ }
  }

  dispose(): void { for (const [id] of this.sessions) this.kill(id); }

  /**
   * Write the provider-specific clean-exit keystroke sequence to a session
   * (Claude: `/exit`; Copilot: Ctrl-C x2). Steps are written with their
   * inter-step delays. Safe to call on a missing/closed session (no-op).
   * Resolves once the sequence has been written (not when the process exits).
   */
  async sendExitSequence(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || session.status === 'closed') return;
    const steps = this.getProviderForType(session.cliType).getExitSequence();
    for (const step of steps) {
      try { session.pty.write(step.data); } catch { return; }
      if (step.delayMs > 0) await new Promise(r => setTimeout(r, step.delayMs));
    }
  }

  /**
   * Cleanly close all active sessions by sending each CLI's provider-specific
   * exit sequence, allowing it to fire its SessionEnd hook and flush its
   * transcript. Force-kills any session that doesn't exit within `timeoutMs`.
   *
   * Resolves once all sessions have closed (or been force-killed).
   */
  async gracefulShutdown(timeoutMs = 5000): Promise<void> {
    const sessions = Array.from(this.sessions.values());
    if (sessions.length === 0) return;

    console.log(`[shutdown] Closing ${sessions.length} session(s) cleanly...`);

    // Wait for each session to exit. node-pty's IPty.onExit fires when the
    // child process terminates (naturally or via SIGKILL).
    const exits = sessions.map(session => new Promise<void>((resolve) => {
      let resolved = false;
      const done = () => { if (!resolved) { resolved = true; resolve(); } };

      try {
        session.pty.onExit(() => done());
      } catch { done(); return; }

      // Provider-specific clean-exit keystrokes (Claude: /exit; Copilot:
      // Ctrl-C x2). Fire-and-forget — the onExit above resolves this promise.
      this.sendExitSequence(session.id).catch(() => done());
    }));

    // Race all exits against a timeout. Anything still alive gets force-killed.
    const allExited = Promise.all(exits).then(() => {});
    const timeout = new Promise<void>(resolve => setTimeout(resolve, timeoutMs));

    await Promise.race([allExited, timeout]);

    // Force-kill any stragglers
    let forced = 0;
    for (const session of sessions) {
      if (session.status !== 'closed') {
        try { session.pty.kill(); forced++; } catch {}
        session.status = 'closed';
        this.sessions.delete(session.id);
        clearNavigationCapability(session.id);
      }
    }
    if (forced > 0) console.log(`[shutdown] Force-killed ${forced} stragglers`);
    console.log('[shutdown] All sessions closed');
  }
}
