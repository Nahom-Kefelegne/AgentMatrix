import { execSync } from 'child_process';
import { join } from 'path';
import { homedir } from 'os';
import type { IPty } from 'node-pty';
import { OutputParser, type PtyState, type StateInfo } from './OutputParser';

export interface PtySession {
  id: string;
  pty: IPty;
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

  private findClaudeBinary(): string {
    try {
      const cmd = process.platform === 'win32' ? 'where claude' : 'which claude';
      return execSync(cmd, { encoding: 'utf-8' }).trim().split('\n')[0];
    } catch {
      throw new Error('Claude CLI not found on PATH.');
    }
  }

  findSessionCwd(sessionId: string): string | undefined {
    try {
      const { existsSync, readdirSync, statSync, openSync, readSync, closeSync } = require('fs');
      const { sep } = require('path');
      const projectsDir = join(homedir(), '.claude', 'projects');
      if (!existsSync(projectsDir)) return undefined;

      // Cross-platform: scan directories instead of using `find`
      const dirs = readdirSync(projectsDir);
      for (const dir of dirs) {
        const dirPath = join(projectsDir, dir);
        try {
          if (!statSync(dirPath).isDirectory()) continue;
          const transcriptPath = join(dirPath, `${sessionId}.jsonl`);
          if (existsSync(transcriptPath)) {
            // Try reading cwd from transcript first line
            try {
              const fd = openSync(transcriptPath, 'r');
              const buf = Buffer.alloc(4000);
              readSync(fd, buf, 0, 4000, 0);
              closeSync(fd);
              const firstLine = buf.toString('utf-8').split('\n')[0];
              const parsed = JSON.parse(firstLine);
              if (parsed.cwd && existsSync(parsed.cwd)) return parsed.cwd;
            } catch {}

            // Fall back: decode dir name with greedy path matching
            const encoded = dir.replace(/^-/, '');
            const resolved = this.decodeDirName(encoded, existsSync);
            return resolved || undefined;
          }
        } catch {}
      }
      return undefined;
    } catch { return undefined; }
  }

  /** Decode a project dir name back to a real filesystem path (handles hyphens in folder names) */
  private decodeDirName(encoded: string, existsSync: (p: string) => boolean): string | null {
    const { sep } = require('path');
    const segments = encoded.split('-');
    let p = '';
    let i = 0;
    while (i < segments.length) {
      let found = false;
      for (let end = segments.length; end > i; end--) {
        const candidate = p + sep + segments.slice(i, end).join('-');
        if (existsSync(candidate)) { p = candidate; i = end; found = true; break; }
      }
      if (!found) { p += sep + segments[i]; i++; }
    }
    return existsSync(p) ? p : null;
  }

  private createPtySession(id: string, ptyProcess: IPty): PtySession {
    const session: PtySession = {
      id, pty: ptyProcess, status: 'starting',
      currentState: 'busy', contextUsage: null,
      outputBuffer: [],
      onData: null, onReady: null, onStateChange: null, onContextUpdate: null,
      pendingPrompt: null,
    };

    ptyProcess.onData((data: string) => {
      session.outputBuffer.push(data);
      if (session.outputBuffer.length > 50) session.outputBuffer = session.outputBuffer.slice(-20);
      if (session.onData) session.onData(data);

      // Parse context usage — check single chunk AND recent buffer
      const recent = session.outputBuffer.slice(-3).join('');
      const ctx = OutputParser.parseContextUsage(data) ?? OutputParser.parseContextUsage(recent);
      if (ctx !== null && ctx !== session.contextUsage) {
        session.contextUsage = ctx;
        if (session.onContextUpdate) session.onContextUpdate(ctx);
      }

      const prev = session.currentState;
      const recentForReady = session.outputBuffer.slice(-3).join('');

      if (OutputParser.isPromptReady(recentForReady)) {
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

  private spawnPty(cwd: string, claudeArgs: string[]): IPty {
    const pty = require('node-pty');
    const claudePath = this.findClaudeBinary();
    const { existsSync } = require('fs');
    const safeCwd = existsSync(cwd) ? cwd : homedir();
    const claudeCmd = `${claudePath} ${claudeArgs.join(' ')}`;
    const env = { ...process.env };
    delete env.CLAUDECODE;

    if (process.platform === 'win32') {
      return pty.spawn('cmd.exe', ['/c', `cd /d "${safeCwd}" && ${claudeCmd}`], {
        cwd: safeCwd, cols: 120, rows: 40, env,
      });
    }
    const shell = process.env.SHELL || '/bin/bash';
    return pty.spawn(shell, ['-c', `cd "${safeCwd}" && ${claudeCmd}`], {
      cwd: safeCwd, cols: 120, rows: 40, env,
    });
  }

  spawnNew(id: string, opts: {
    cwd: string; sessionUuid?: string; name?: string;
    permissionMode?: string; model?: string; effort?: string;
    allowedTools?: string; systemPrompt?: string;
  }): PtySession {
    if (this.sessions.has(id)) throw new Error(`Session ${id} already exists`);
    const args: string[] = [];
    if (opts.sessionUuid) args.push('--session-id', opts.sessionUuid);
    if (opts.permissionMode === 'bypassPermissions') args.push('--dangerously-skip-permissions');
    else if (opts.permissionMode) args.push('--permission-mode', opts.permissionMode);
    if (opts.model) args.push('--model', opts.model);
    if (opts.effort) args.push('--effort', opts.effort);
    if (opts.allowedTools) args.push('--allowedTools', opts.allowedTools);
    if (opts.systemPrompt) args.push('--append-system-prompt', `"${opts.systemPrompt.replace(/"/g, '\\"')}"`);
    return this.createPtySession(id, this.spawnPty(opts.cwd, args));
  }

  spawnResume(id: string, opts: { cwd?: string; resumeId: string; fork?: boolean }): PtySession {
    if (this.sessions.has(id)) throw new Error(`Session ${id} already exists`);
    const cwd = this.findSessionCwd(opts.resumeId) ?? opts.cwd ?? homedir();
    const args = ['--resume', opts.resumeId, '--dangerously-skip-permissions'];
    if (opts.fork) args.push('--fork-session');
    return this.createPtySession(id, this.spawnPty(cwd, args));
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
