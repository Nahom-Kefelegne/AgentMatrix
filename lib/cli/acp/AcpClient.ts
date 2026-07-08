import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';

export interface AcpQueryResult {
  success: boolean;
  content: string;
  lines: string[];
}

interface Pending {
  resolve: (msg: any) => void;
  reject: (err: Error) => void;
}

/**
 * Minimal JSON-RPC client for Copilot's Agent Client Protocol
 * (`copilot --acp`, newline-delimited JSON over stdio).
 *
 * Replaces the PromptInjector's "type a prompt into the PTY, tell the agent to
 * write a file, poll for the file" hack: instead we load the session and run a
 * prompt out-of-band, streaming the reply directly. Verified safe to run even
 * while a live PTY holds the same session.
 *
 * IMPORTANT: spawn the copilot binary DIRECTLY (never via the `agency` wrapper),
 * because Agency conflicts with ACP's session handling.
 *
 * One client == one `copilot --acp` process. Create it, `initialize()`, then
 * `runQuery()`, then `dispose()`. Short-lived per query is fine — startup is a
 * few hundred ms and the model call dominates.
 */
export class AcpClient {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private buf = '';
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private disposed = false;
  private chunkSink: ((text: string) => void) | null = null;

  constructor(
    private readonly binaryPath: string,
    private readonly cwd: string,
  ) {}

  /** Spawn `copilot --acp` and perform the ACP handshake. */
  async initialize(): Promise<void> {
    const proc = spawn(this.binaryPath, ['--acp'], {
      cwd: this.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    this.proc = proc;

    proc.stdout.on('data', (d: Buffer) => this.onData(d.toString()));
    proc.on('exit', () => this.failAllPending(new Error('ACP process exited')));
    proc.on('error', (err) => this.failAllPending(err));

    await this.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: 'agentmatrix', version: '1' },
    });
  }

  /** Load an existing Copilot session by id so its history is in context. */
  async loadSession(sessionId: string): Promise<void> {
    await this.request('session/load', {
      sessionId,
      cwd: this.cwd,
      mcpServers: [],
    });
  }

  /**
   * Run a prompt against the loaded session and return the assistant's text.
   * Streams `agent_message_chunk` updates and resolves when the turn ends.
   */
  async runQuery(sessionId: string, instruction: string, timeoutMs = 45000): Promise<AcpQueryResult> {
    let chunks = '';
    this.chunkSink = (text: string) => { chunks += text; };

    const empty: AcpQueryResult = { success: false, content: '', lines: [] };
    try {
      const res = await this.request(
        'session/prompt',
        { sessionId, prompt: [{ type: 'text', text: instruction }] },
        timeoutMs,
      );
      const stopReason = res?.result?.stopReason;
      const content = chunks.trim();
      if (!content) return { ...empty, success: stopReason === 'end_turn' };
      return {
        success: true,
        content,
        lines: content.split('\n').map(l => l.trim()).filter(l => l.length > 0),
      };
    } catch {
      return empty;
    } finally {
      this.chunkSink = null;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.failAllPending(new Error('ACP client disposed'));
    try { this.proc?.kill(); } catch { /* already gone */ }
    this.proc = null;
  }

  // ── internals ──────────────────────────────────────────────────────

  private onData(data: string): void {
    this.buf += data;
    let idx: number;
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 1);
      if (!line.trim()) continue;
      let msg: any;
      try { msg = JSON.parse(line); } catch { continue; }
      this.handleMessage(msg);
    }
  }

  private handleMessage(msg: any): void {
    // Response to one of our requests.
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      p.resolve(msg);
      return;
    }

    // Streamed session updates (assistant message chunks).
    if (msg.method === 'session/update') {
      const update = msg.params?.update;
      if (update?.sessionUpdate === 'agent_message_chunk' && this.chunkSink) {
        const text = update.content?.text;
        if (typeof text === 'string') this.chunkSink(text);
      }
      return;
    }

    // Server→client requests. Auto-approve permission prompts so an
    // out-of-band query never blocks waiting for user input.
    if (msg.method && msg.id !== undefined) {
      if (/permission/i.test(msg.method)) {
        this.respond(msg.id, { outcome: { outcome: 'allow' } });
      } else {
        // Unknown request — acknowledge with an empty result rather than hang.
        this.respond(msg.id, {});
      }
    }
  }

  private request(method: string, params: unknown, timeoutMs = 20000): Promise<any> {
    if (!this.proc || this.disposed) return Promise.reject(new Error('ACP not initialized'));
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`ACP ${method} timed out`));
        }
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (msg) => { clearTimeout(timer); resolve(msg); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      });
      try {
        this.proc!.stdin.write(payload);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err as Error);
      }
    });
  }

  private respond(id: number, result: unknown): void {
    if (!this.proc || this.disposed) return;
    try {
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
    } catch { /* process gone */ }
  }

  private failAllPending(err: Error): void {
    for (const [, p] of this.pending) p.reject(err);
    this.pending.clear();
  }
}
