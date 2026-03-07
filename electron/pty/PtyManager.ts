import { execSync } from 'child_process';
import { join } from 'path';
import { homedir } from 'os';
import type { IPty } from 'node-pty';
import { OutputParser } from './OutputParser';

export interface PtySession {
  id: string;
  pty: IPty;
  status: 'starting' | 'ready' | 'busy' | 'closed';
  needsConsent: boolean; // true if trust prompt detected
  outputBuffer: string[];
  onData: ((data: string) => void) | null;
  onReady: (() => void) | null;
  onConsent: (() => void) | null;
  pendingPrompt: string | null;
}

export interface SpawnOptions {
  cwd?: string;
  resumeName?: string;
}

export class PtyManager {
  private sessions = new Map<string, PtySession>();

  /**
   * Find the correct project cwd by locating the transcript file.
   * The project directory name in ~/.claude/projects/ encodes the path.
   * We need to cd into a path that matches this project dir so Claude finds the session.
   */
  private findSessionCwd(sessionId: string): string | undefined {
    try {
      const projectsDir = join(homedir(), '.claude', 'projects');
      const output = execSync(
        `find "${projectsDir}" -name "${sessionId}.jsonl" -type f 2>/dev/null`,
        { encoding: 'utf-8', timeout: 5000 },
      ).trim();
      const transcriptPath = output.split('\n')[0];
      if (!transcriptPath) return undefined;

      // Extract project dir name: e.g. -Users-nkefelegne-Desktop-DEV
      const parts = transcriptPath.split('/');
      const projectsIdx = parts.indexOf('projects');
      if (projectsIdx < 0 || projectsIdx + 1 >= parts.length) return undefined;
      const dirName = parts[projectsIdx + 1];

      // Convert back to path: -Users-nkefelegne-Desktop-DEV -> /Users/nkefelegne/Desktop/DEV
      const derived = dirName.replace(/^-/, '/').replace(/-/g, '/');

      // Verify it exists — if not, try the raw transcript first line
      const { existsSync, openSync, readSync, closeSync } = require('fs');
      if (existsSync(derived)) return derived;

      // Try reading cwd from transcript first line
      try {
        const fd = openSync(transcriptPath, 'r');
        const buf = Buffer.alloc(3000);
        readSync(fd, buf, 0, 3000, 0);
        closeSync(fd);
        const firstLine = buf.toString('utf-8').split('\n')[0];
        const data = JSON.parse(firstLine);
        if (data.cwd && existsSync(data.cwd)) return data.cwd;
      } catch {}

      return derived; // return even if not verified
    } catch {
      return undefined;
    }
  }

  private findClaudeBinary(): string {
    try {
      const cmd = process.platform === 'win32' ? 'where claude' : 'which claude';
      return execSync(cmd, { encoding: 'utf-8' }).trim().split('\n')[0];
    } catch {
      throw new Error(
        'Claude CLI not found. Make sure "claude" is installed and on your PATH.'
      );
    }
  }

  spawn(sessionId: string, options: SpawnOptions = {}): PtySession {
    if (this.sessions.has(sessionId)) {
      throw new Error(`PTY session "${sessionId}" already exists`);
    }

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pty = require('node-pty');
    const { existsSync } = require('fs');
    const claudePath = this.findClaudeBinary();
    const resumeId = sessionId;

    // Find the correct cwd from the transcript's project directory
    const sessionCwd = this.findSessionCwd(sessionId);
    const requestedCwd = sessionCwd ?? options.cwd ?? process.cwd();
    const cwd = existsSync(requestedCwd) ? requestedCwd : homedir();
    console.log(`[pty:cwd] sessionCwd=${sessionCwd} requested=${requestedCwd} final=${cwd}`);

    // Remove CLAUDECODE env var to prevent nested-session errors
    const env = { ...process.env };
    delete env.CLAUDECODE;

    let ptyProcess: IPty;

    // Use --fork-session so we can resume sessions that are still running elsewhere
    // cd into session cwd first so Claude trusts the project directory
    const claudeCmd = `${claudePath} --resume ${resumeId} --fork-session --dangerously-skip-permissions`;

    if (process.platform === 'win32') {
      ptyProcess = pty.spawn('cmd.exe', ['/c', `cd /d "${cwd}" && ${claudeCmd}`], {
        cwd,
        cols: 120,
        rows: 40,
        env,
      });
    } else {
      const shell = process.env.SHELL || '/bin/bash';
      ptyProcess = pty.spawn(shell, [
        '-c',
        `cd "${cwd}" && ${claudeCmd}`,
      ], {
        cwd,
        cols: 120,
        rows: 40,
        env,
      });
    }

    console.log(`[pty:spawned] pid=${ptyProcess.pid} cmd="${claudeCmd}" cwd="${cwd}"`);

    const session: PtySession = {
      id: sessionId,
      pty: ptyProcess,
      status: 'starting',
      needsConsent: false,
      outputBuffer: [],
      onData: null,
      onReady: null,
      onConsent: null,
      pendingPrompt: null,
    };

    ptyProcess.onData((data: string) => {
      console.log(`[pty:data] len=${data.length} ${JSON.stringify(data).slice(0, 100)}`);
      session.outputBuffer.push(data);

      // Detect consent/trust prompt
      const stripped = OutputParser.stripAnsi(data);
      if (session.status === 'starting' && !session.needsConsent &&
          /Yes, I trust this folder|trust this project/i.test(stripped)) {
        console.log('[pty:consent-needed]', sessionId.slice(0, 8));
        session.needsConsent = true;
        if (session.onConsent) session.onConsent();
      }

      // Relay raw data to subscriber
      if (session.onData) {
        session.onData(data);
      }

      // Detect prompt-ready state (when starting up or after a response)
      if (session.status === 'starting' || session.status === 'busy') {
        const recentOutput = session.outputBuffer.slice(-10).join('');
        if (OutputParser.isPromptReady(recentOutput)) {
          session.status = 'ready';
          // Trim buffer to avoid memory growth
          if (session.outputBuffer.length > 100) {
            session.outputBuffer = session.outputBuffer.slice(-20);
          }
          // Flush any queued prompt now that Claude is ready
          if (session.pendingPrompt) {
            const prompt = session.pendingPrompt;
            session.pendingPrompt = null;
            console.log(`[pty:flush-pending] "${prompt.slice(0, 60)}"`);
            session.status = 'busy';
            session.pty.write(prompt + '\r');
          }
          if (session.onReady) {
            session.onReady();
          }
        }
      }
    });

    ptyProcess.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
      console.log(`[pty:exit] sessionId=${sessionId.slice(0, 8)} exitCode=${exitCode} signal=${signal}`);
      session.status = 'closed';
      this.sessions.delete(sessionId);
    });

    this.sessions.set(sessionId, session);
    return session;
  }

  sendPrompt(sessionId: string, prompt: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`PTY session "${sessionId}" not found`);
    }
    if (session.status === 'closed') {
      throw new Error(`PTY session "${sessionId}" is closed`);
    }

    if (session.status === 'ready') {
      // Claude is ready — send immediately
      console.log(`[pty:write] "${prompt.slice(0, 60)}"`);
      session.status = 'busy';
      session.pty.write(prompt + '\r');
    } else {
      // Claude not ready yet (still starting) — queue the prompt
      console.log(`[pty:queued] "${prompt.slice(0, 60)}" (status=${session.status})`);
      session.pendingPrompt = prompt;
    }
  }

  onOutput(sessionId: string, callback: (data: string) => void): () => void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`PTY session "${sessionId}" not found`);
    }

    session.onData = callback;

    // Return unsubscribe function
    return () => {
      if (session.onData === callback) {
        session.onData = null;
      }
    };
  }

  onReady(sessionId: string, callback: () => void): () => void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`PTY session "${sessionId}" not found`);
    }

    session.onReady = callback;

    // If already ready, fire immediately
    if (session.status === 'ready') {
      callback();
    }

    // Return unsubscribe function
    return () => {
      if (session.onReady === callback) {
        session.onReady = null;
      }
    };
  }

  kill(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    try {
      session.pty.kill();
    } catch {
      // Already dead — ignore
    }
    session.status = 'closed';
    this.sessions.delete(sessionId);
  }

  hasPty(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  getSession(sessionId: string): PtySession | undefined {
    return this.sessions.get(sessionId);
  }

  dispose(): void {
    for (const [id] of this.sessions) {
      this.kill(id);
    }
  }
}
