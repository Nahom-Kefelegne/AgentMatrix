import { execSync } from 'child_process';
import { join } from 'path';
import { homedir } from 'os';
import type { IPty } from 'node-pty';
import { OutputParser } from './OutputParser';

export interface PtySession {
  id: string;
  pty: IPty;
  status: 'starting' | 'ready' | 'busy' | 'closed';
  needsConsent: boolean;
  outputBuffer: string[];
  onData: ((data: string) => void) | null;
  onReady: (() => void) | null;
  onConsent: (() => void) | null;
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

  private findSessionCwd(sessionId: string): string | undefined {
    try {
      const projectsDir = join(homedir(), '.claude', 'projects');
      const output = execSync(
        `find "${projectsDir}" -name "${sessionId}.jsonl" -type f 2>/dev/null`,
        { encoding: 'utf-8', timeout: 5000 },
      ).trim();
      if (!output) return undefined;
      const parts = output.split('/');
      const idx = parts.indexOf('projects');
      if (idx < 0 || idx + 1 >= parts.length) return undefined;
      const derived = parts[idx + 1].replace(/^-/, '/').replace(/-/g, '/');
      const { existsSync } = require('fs');
      return existsSync(derived) ? derived : undefined;
    } catch { return undefined; }
  }

  private createPtySession(id: string, ptyProcess: IPty): PtySession {
    const session: PtySession = {
      id, pty: ptyProcess, status: 'starting',
      needsConsent: false, outputBuffer: [],
      onData: null, onReady: null, onConsent: null, pendingPrompt: null,
    };

    ptyProcess.onData((data: string) => {
      session.outputBuffer.push(data);

      // Detect consent prompt
      const stripped = OutputParser.stripAnsi(data);
      if (session.status === 'starting' && !session.needsConsent &&
          /Yes, I trust this folder|trust this project/i.test(stripped)) {
        session.needsConsent = true;
        if (session.onConsent) session.onConsent();
      }

      if (session.onData) session.onData(data);

      // Detect prompt-ready
      if (session.status === 'starting' || session.status === 'busy') {
        const recent = session.outputBuffer.slice(-10).join('');
        if (OutputParser.isPromptReady(recent)) {
          session.status = 'ready';
          if (session.outputBuffer.length > 100) {
            session.outputBuffer = session.outputBuffer.slice(-20);
          }
          if (session.pendingPrompt) {
            const prompt = session.pendingPrompt;
            session.pendingPrompt = null;
            session.status = 'busy';
            session.pty.write(prompt + '\r');
          }
          if (session.onReady) session.onReady();
        }
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

    console.log(`[pty:spawn] cmd="${claudeCmd}" cwd="${safeCwd}"`);

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

  /** Spawn a brand new Claude session (no resume) */
  spawnNew(id: string, opts: {
    cwd: string;
    name?: string;
    permissionMode?: string;
    model?: string;
    effort?: string;
    allowedTools?: string;
    systemPrompt?: string;
  }): PtySession {
    if (this.sessions.has(id)) throw new Error(`Session ${id} already exists`);

    const args: string[] = [];
    if (opts.permissionMode === 'bypassPermissions') args.push('--dangerously-skip-permissions');
    else if (opts.permissionMode) args.push('--permission-mode', opts.permissionMode);
    if (opts.model) args.push('--model', opts.model);
    if (opts.effort) args.push('--effort', opts.effort);
    if (opts.allowedTools) args.push('--allowedTools', opts.allowedTools);
    if (opts.systemPrompt) args.push('--append-system-prompt', `"${opts.systemPrompt.replace(/"/g, '\\"')}"`);

    const ptyProcess = this.spawnPty(opts.cwd, args);
    return this.createPtySession(id, ptyProcess);
  }

  /** Resume an existing session by ID */
  spawnResume(id: string, opts: {
    cwd?: string;
    resumeId: string;
    fork?: boolean;
  }): PtySession {
    if (this.sessions.has(id)) throw new Error(`Session ${id} already exists`);

    const cwd = this.findSessionCwd(opts.resumeId) ?? opts.cwd ?? homedir();
    const args = ['--resume', opts.resumeId, '--dangerously-skip-permissions'];
    if (opts.fork) args.push('--fork-session');

    const ptyProcess = this.spawnPty(cwd, args);
    return this.createPtySession(id, ptyProcess);
  }

  sendPrompt(sessionId: string, prompt: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    if (session.status === 'closed') throw new Error(`Session ${sessionId} closed`);
    if (session.status === 'ready') {
      session.status = 'busy';
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
