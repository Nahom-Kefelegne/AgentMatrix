import { join } from 'path';
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
  private defaultProvider: CliProvider;

  constructor(providers?: Map<CliType, CliProvider>) {
    if (providers) {
      this.providers = providers;
      // Default to first provider (should be claude)
      this.defaultProvider = providers.values().next().value!;
    } else {
      // Lazy-load providers to avoid issues if lib/cli isn't available yet
      try {
        const { getProvider, getDefaultProvider } = require('../../lib/cli');
        const claude = getProvider('claude') as CliProvider;
        this.providers.set('claude', claude);
        try {
          const copilot = getProvider('copilot') as CliProvider;
          this.providers.set('copilot', copilot);
        } catch { /* Copilot not available */ }
        this.defaultProvider = getDefaultProvider() as CliProvider;
      } catch {
        // Fallback: create Claude provider directly
        const { ClaudeProvider } = require('../../lib/cli/ClaudeProvider');
        const claude = new ClaudeProvider();
        this.providers.set('claude', claude);
        this.defaultProvider = claude;
      }
    }
  }

  private getProviderForType(cliType?: CliType): CliProvider {
    if (cliType && this.providers.has(cliType)) {
      return this.providers.get(cliType)!;
    }
    return this.defaultProvider;
  }

  /**
   * Decode a Claude project dir name back to a real filesystem path.
   * Claude encodes path separators as '-', but folder names can also contain '-'.
   * We greedily try to match existing directories from left to right.
   *
   * macOS/Linux: "Users-johndoe-projects-my-app" → /Users/johndoe/projects/my-app
   * Windows:     "Q-src-teams-modular" → Q:\src\teams-modular
   *              "C-Users-name-project" → C:\Users\name\project
   */
  private decodeDirName(encoded: string, existsSync: (p: string) => boolean): string | null {
    const segments = encoded.split('-');
    const isWin = process.platform === 'win32';
    const sep = isWin ? '\\' : '/';
    let path = '';
    let i = 0;

    // Windows: check if first segment is a drive letter (single letter)
    if (isWin && segments.length > 0 && /^[A-Za-z]$/.test(segments[0])) {
      path = segments[0].toUpperCase() + ':';
      i = 1;
      // Check if just the drive root exists
      if (!existsSync(path + '\\')) {
        path = '';
        i = 0;
      }
    }

    while (i < segments.length) {
      let found = false;
      for (let end = segments.length; end > i; end--) {
        const joined = segments.slice(i, end).join('-');
        const candidate = path ? path + sep + joined : (isWin ? joined : '/' + joined);
        if (existsSync(candidate)) {
          path = candidate;
          i = end;
          found = true;
          break;
        }
      }
      if (!found) {
        path = path ? path + sep + segments[i] : (isWin ? segments[i] : '/' + segments[i]);
        i++;
      }
    }
    return existsSync(path) ? path : null;
  }

  findSessionCwd(sessionId: string): string | undefined {
    try {
      const { existsSync, readdirSync, statSync, openSync, readSync, closeSync } = require('fs');
      const projectsDir = join(homedir(), '.claude', 'projects');
      if (!existsSync(projectsDir)) return undefined;

      // Cross-platform: scan directories instead of using `find`
      let transcriptPath: string | undefined;
      const dirs = readdirSync(projectsDir);
      for (const dir of dirs) {
        const dirPath = join(projectsDir, dir);
        try {
          if (!statSync(dirPath).isDirectory()) continue;
          const candidate = join(dirPath, `${sessionId}.jsonl`);
          if (existsSync(candidate)) { transcriptPath = candidate; break; }
        } catch {}
      }
      if (!transcriptPath) return undefined;

      // Try reading cwd from transcript first line
      try {
        const fd = openSync(transcriptPath, 'r');
        const buf = Buffer.alloc(4000);
        readSync(fd, buf, 0, 4000, 0);
        closeSync(fd);
        const firstLine = buf.toString('utf-8').split('\n')[0];
        const parsed = JSON.parse(firstLine);
        if (parsed.cwd && existsSync(parsed.cwd)) {
          return parsed.cwd;
        }
      } catch { /* fall through to dir name decoding */ }

      // Fall back to decoding project dir name
      const { sep } = require('path');
      const parts = transcriptPath.split(sep);
      const idx = parts.indexOf('projects');
      if (idx < 0 || idx + 1 >= parts.length) return undefined;
      const encoded = parts[idx + 1].replace(/^-/, ''); // strip leading dash
      const resolved = this.decodeDirName(encoded, existsSync);
      console.log(`[findSessionCwd] id=${sessionId.slice(0, 12)} encoded="${encoded}" resolved="${resolved}"`);
      return resolved || undefined;
    } catch (err) {
      console.error('[findSessionCwd] error:', err);
      return undefined;
    }
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
      try {
        const cmd = process.platform === 'win32' ? 'where agency' : 'which agency';
        const { execSync } = require('child_process');
        spawnBinary = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim().split('\n')[0];
      } catch {
        // Agency not found, fall back to direct binary
        spawnBinary = provider.findBinary();
        spawnArgs = cliArgs;
        console.warn(`[spawnPty] Agency enabled but not found, falling back to direct binary`);
      }
      spawnBinary = spawnBinary!;
      spawnArgs = [provider.type, ...cliArgs];
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
    cliType?: CliType;
  }): PtySession {
    if (this.sessions.has(id)) throw new Error(`Session ${id} already exists`);

    const cliType = opts.cliType || 'claude';
    const provider = this.getProviderForType(cliType);

    // For Claude, always inject MCP status instructions + user's custom prompt
    let systemPrompt = opts.systemPrompt;
    if (cliType === 'claude') {
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
    });

    return this.createPtySession(id, this.spawnPty(opts.cwd, args, cliType), cliType);
  }

  spawnResume(id: string, opts: {
    cwd?: string; resumeId: string; fork?: boolean; systemPrompt?: string;
    cliType?: CliType;
  }): PtySession {
    if (this.sessions.has(id)) throw new Error(`Session ${id} already exists`);

    const cliType = opts.cliType || 'claude';
    const provider = this.getProviderForType(cliType);

    const foundCwd = this.findSessionCwd(opts.resumeId);
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
  dispose(): void { for (const [id] of this.sessions) this.kill(id); }
}
