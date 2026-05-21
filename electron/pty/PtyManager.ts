import { homedir } from 'os';
import type { IPty } from 'node-pty';
import { OutputParser, type PtyState, type StateInfo } from './OutputParser';
import type { CliProvider, CliType } from '../../lib/cli/CliProvider';

export interface PtySession {
  id: string;
  pty: IPty;
  cliType: CliType;
  status: 'starting' | 'ready' | 'busy' | 'closed';
  currentState: PtyState;
  contextUsage: number | null; // % used (0-100)
  outputBuffer: string[];
  onData: ((data: string) => void) | null;
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
      onData: null, onReady: null, onStateChange: null, onContextUpdate: null,
      pendingPrompt: null,
    };

    ptyProcess.onData((data: string) => {
      session.outputBuffer.push(data);
      if (session.outputBuffer.length > 500) session.outputBuffer = session.outputBuffer.slice(-300);
      if (session.onData) session.onData(data);

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
        }
      } else if (prev === 'ready') {
        session.currentState = 'busy';
        session.status = 'busy';
        if (session.onStateChange) session.onStateChange({ state: 'busy' });
      }
    });

    ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      console.log(`[pty:exit] id=${id.slice(0, 12)} code=${exitCode}`);
      session.status = 'closed';
      this.sessions.delete(id);
    });

    this.sessions.set(id, session);
    return session;
  }

  private spawnPty(cwd: string, cliArgs: string[], cliType?: CliType): IPty {
    const pty = require('node-pty');
    const provider = this.getProviderForType(cliType);
    const { existsSync } = require('fs');
    const cwdExists = existsSync(cwd);
    const safeCwd = cwdExists ? cwd : homedir();
    const env = { ...process.env };
    delete env.CLAUDECODE;

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
        spawnArgs = [provider.type, ...cliArgs];
        agencyFound = true;
      } catch {
        // Agency not found — try direct binary, but give a clear error if that also fails
        console.warn(`[spawnPty] Agency enabled but 'agency' not found on PATH, trying direct ${provider.type} binary`);
        try {
          spawnBinary = provider.findBinary();
          spawnArgs = cliArgs;
        } catch {
          throw new Error(`Agency binary not found on PATH and ${provider.type} CLI is not directly installed. Install Agency or the ${provider.displayName} CLI.`);
        }
      }
    } else {
      spawnBinary = provider.findBinary();
      spawnArgs = cliArgs;
    }

    const label = useAgency ? `agency ${provider.type}` : provider.type;
    console.log(`[spawnPty] ${label} cwd="${safeCwd}" args=${spawnArgs.join(' ')}`);

    // Use 80 cols default — CLI TUI renders welcome screen at spawn time.
    // The terminal panel will resize the PTY to match when it opens.
    if (process.platform === 'win32') {
      return pty.spawn(spawnBinary, spawnArgs, {
        cwd: safeCwd, cols: 80, rows: 24, env,
      });
    }
    const shell = process.env.SHELL || '/bin/bash';
    const fullCmd = `${spawnBinary} ${spawnArgs.join(' ')}`;
    return pty.spawn(shell, ['-c', `cd "${safeCwd}" && ${fullCmd}`], {
      cwd: safeCwd, cols: 80, rows: 24, env,
    });
  }

  spawnNew(id: string, opts: {
    cwd: string; sessionUuid?: string; name?: string;
    permissionMode?: string; model?: string; effort?: string;
    allowedTools?: string; systemPrompt?: string;
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
      permissionMode: opts.permissionMode,
      model: opts.model,
      effort: opts.effort,
      allowedTools: opts.allowedTools,
      systemPrompt,
      copilotMode: opts.copilotMode,
    });

    console.log(`[spawnNew] id=${id.slice(0, 8)} requestedCli=${opts.cliType} actualProvider=${provider.type} args=${args.join(' ')}`);
    return this.createPtySession(id, this.spawnPty(opts.cwd, args, cliType), cliType);
  }

  spawnResume(id: string, opts: {
    cwd?: string; resumeId: string; fork?: boolean; systemPrompt?: string;
    cliType?: CliType;
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
    });

    // For Claude, append system prompt on resume if provided
    if (cliType === 'claude' && opts.systemPrompt) {
      const oneLine = opts.systemPrompt.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
      const escaped = oneLine.replace(/'/g, "'\\''");
      args.push('--append-system-prompt', `'${escaped}'`);
    }

    return this.createPtySession(id, this.spawnPty(cwd, args, cliType), cliType);
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
    session.onData = callback;
    return () => { if (session.onData === callback) session.onData = null; };
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
  }

  hasPty(sessionId: string): boolean { return this.sessions.has(sessionId); }
  getSession(sessionId: string): PtySession | undefined { return this.sessions.get(sessionId); }
  getAllSessions(): PtySession[] { return Array.from(this.sessions.values()); }
  dispose(): void { for (const [id] of this.sessions) this.kill(id); }

  /**
   * Cleanly close all active sessions by sending /exit, allowing the CLI
   * to fire its SessionEnd hook and flush its transcript. Force-kills any
   * session that doesn't exit within `timeoutMs`.
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

      // Send /exit — works for Claude CLI, Copilot CLI, and raw shells.
      // Send it twice separated: text + Enter, same pattern as PromptInjector.
      try {
        session.pty.write('/exit\r');
      } catch { done(); }
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
      }
    }
    if (forced > 0) console.log(`[shutdown] Force-killed ${forced} stragglers`);
    console.log('[shutdown] All sessions closed');
  }
}
