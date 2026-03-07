import { execSync } from 'child_process';
import type { IPty } from 'node-pty';
import { OutputParser } from './OutputParser';

export interface PtySession {
  id: string;
  pty: IPty;
  status: 'starting' | 'ready' | 'busy' | 'closed';
  outputBuffer: string[];
  onData: ((data: string) => void) | null;
  onReady: (() => void) | null;
}

export interface SpawnOptions {
  cwd?: string;
  resumeName?: string;
}

export class PtyManager {
  private sessions = new Map<string, PtySession>();

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
    const claudePath = this.findClaudeBinary();
    const resumeName = options.resumeName ?? sessionId;
    const cwd = options.cwd ?? process.cwd();

    // Remove CLAUDECODE env var to prevent nested-session errors
    const env = { ...process.env };
    delete env.CLAUDECODE;

    let ptyProcess: IPty;

    if (process.platform === 'win32') {
      ptyProcess = pty.spawn(claudePath, [
        '--resume', resumeName,
        '--dangerously-skip-permissions',
      ], {
        cwd,
        cols: 120,
        rows: 40,
        env,
      });
    } else {
      const shell = process.env.SHELL || '/bin/bash';
      ptyProcess = pty.spawn(shell, [
        '-c',
        `${claudePath} --resume ${resumeName} --dangerously-skip-permissions`,
      ], {
        cwd,
        cols: 120,
        rows: 40,
        env,
      });
    }

    const session: PtySession = {
      id: sessionId,
      pty: ptyProcess,
      status: 'starting',
      outputBuffer: [],
      onData: null,
      onReady: null,
    };

    ptyProcess.onData((data: string) => {
      session.outputBuffer.push(data);

      // Relay raw data to subscriber
      if (session.onData) {
        session.onData(data);
      }

      // Detect prompt-ready state
      if (session.status !== 'ready' || session.status === 'starting') {
        const recentOutput = session.outputBuffer.slice(-5).join('');
        if (OutputParser.isPromptReady(recentOutput)) {
          session.status = 'ready';
          if (session.onReady) {
            session.onReady();
          }
        }
      }
    });

    ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
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

    session.status = 'busy';
    session.pty.write(prompt + '\r');
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
