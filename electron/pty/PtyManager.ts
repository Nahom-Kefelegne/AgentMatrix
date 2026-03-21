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

  private findClaudeBinary(): string {
    // Try PATH first
    try {
      const cmd = process.platform === 'win32' ? 'where claude' : 'which claude';
      const result = execSync(cmd, { encoding: 'utf-8' }).trim().split(/\r?\n/)[0].trim();
      if (result) return result;
    } catch {}

    // Fallback: check common install locations
    const { existsSync } = require('fs');
    const home = homedir();
    const candidates = process.platform === 'win32'
      ? [
          join(home, '.local', 'bin', 'claude.exe'),
          join(home, '.local', 'bin', 'claude'),
          join(home, 'AppData', 'Local', 'Programs', 'claude', 'claude.exe'),
          join(home, 'AppData', 'Roaming', 'npm', 'claude.cmd'),
          join(home, 'AppData', 'Roaming', 'npm', 'claude'),
          'C:\\Program Files\\Claude\\claude.exe',
        ]
      : [
          '/usr/local/bin/claude',
          join(home, '.local', 'bin', 'claude'),
          join(home, '.npm-global', 'bin', 'claude'),
        ];

    for (const path of candidates) {
      if (existsSync(path)) {
        console.log(`[findClaudeBinary] Found at fallback: ${path}`);
        return path;
      }
    }

    throw new Error('Claude CLI not found. Install it or add it to PATH.');
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
      if (session.outputBuffer.length > 500) session.outputBuffer = session.outputBuffer.slice(-300);
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
    const cwdExists = existsSync(cwd);
    const safeCwd = cwdExists ? cwd : homedir();
    console.log(`[spawnPty] cwd="${cwd}" exists=${cwdExists} safeCwd="${safeCwd}" args=${claudeArgs.join(' ')}`);
    const claudeCmd = `${claudePath} ${claudeArgs.join(' ')}`;
    const env = { ...process.env };
    delete env.CLAUDECODE;

    // Use 80 cols default — Claude TUI renders welcome screen at spawn time.
    // The terminal panel will resize the PTY to match when it opens.
    if (process.platform === 'win32') {
      // Spawn claude directly — cmd.exe can't handle UNC paths
      return pty.spawn(claudePath, claudeArgs, {
        cwd: safeCwd, cols: 80, rows: 24, env,
      });
    }
    const shell = process.env.SHELL || '/bin/bash';
    return pty.spawn(shell, ['-c', `cd "${safeCwd}" && ${claudeCmd}`], {
      cwd: safeCwd, cols: 80, rows: 24, env,
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
    // Always inject MCP status instructions + user's custom prompt
    const mcpInstructions = 'You have access to Agent Matrix MCP tools. When you need user input (questions, decisions, approvals), call mcp__agentmatrix__request_attention with a reason. When you finish the task the user assigned, call mcp__agentmatrix__work_complete with a summary.';
    const fullPrompt = opts.systemPrompt
      ? `${mcpInstructions}\n\n${opts.systemPrompt}`
      : mcpInstructions;
    const escaped = fullPrompt.replace(/'/g, "'\\''");
    args.push('--append-system-prompt', `'${escaped}'`);
    return this.createPtySession(id, this.spawnPty(opts.cwd, args));
  }

  spawnResume(id: string, opts: { cwd?: string; resumeId: string; fork?: boolean; systemPrompt?: string }): PtySession {
    if (this.sessions.has(id)) throw new Error(`Session ${id} already exists`);
    const foundCwd = this.findSessionCwd(opts.resumeId);
    const cwd = foundCwd ?? opts.cwd ?? homedir();
    console.log(`[spawnResume] id=${id.slice(0, 12)} resumeId=${opts.resumeId.slice(0, 12)} foundCwd=${foundCwd} optsCwd=${opts.cwd} finalCwd=${cwd}`);
    const args = ['--resume', opts.resumeId, '--dangerously-skip-permissions'];
    if (opts.fork) args.push('--fork-session');
    if (opts.fork && opts.systemPrompt) {
      const escaped = opts.systemPrompt.replace(/'/g, "'\\''");
      args.push('--append-system-prompt', `'${escaped}'`);
    }
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
