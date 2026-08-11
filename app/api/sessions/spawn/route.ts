import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { openSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getProvider } from '@/lib/cli';
import type { CliType } from '@/lib/types';

/**
 * Headless "fire-and-forget" task spawn. Used by external integrations
 * that want to kick off a CLI with one prompt and not interact with it.
 * For interactive sessions, see the socket flow in `terminalBridge.ts`.
 *
 * The argument shape (--print, --dangerously-skip-permissions, then task
 * as positional) is Claude-specific. Copilot's headless equivalent
 * (--prompt) hasn't been wired through here yet.
 */
export async function POST(request: Request) {
  try {
    const { task, cwd, name, cliType: rawCli } = await request.json();
    // Preserve the caller's CLI rather than folding unknown values onto
    // 'claude'. Coercing here would let a `cliType: 'kimi'` request slip past
    // the not-supported guard below and silently launch Claude with
    // Claude-only flags.
    const cliType: CliType =
      rawCli === 'copilot' || rawCli === 'kimi' || rawCli === 'claude' ? rawCli : 'claude';

    if (!task || !cwd) {
      return NextResponse.json({ error: 'Missing task or cwd' }, { status: 400 });
    }

    if (cliType !== 'claude') {
      return NextResponse.json(
        { error: `Headless spawn is not yet supported for cliType=${cliType}` },
        { status: 501 },
      );
    }

    const provider = getProvider(cliType);
    const binary = provider.findBinary();

    const sessionName = name || `task-${Date.now()}`;
    const args = ['--print', '--dangerously-skip-permissions', task];

    const logFile = join(tmpdir(), `agentmatrix-spawn-${sessionName}.log`);
    const out = openSync(logFile, 'a');

    // Strip CLAUDECODE env to prevent "nested session" error.
    const env = { ...process.env };
    delete env.CLAUDECODE;

    const child = spawn(binary, args, {
      cwd,
      detached: true,
      stdio: ['ignore', out, out],
      env,
    });
    child.unref();

    return NextResponse.json({ ok: true, name: sessionName, logFile });
  } catch (error) {
    console.error('[sessions/spawn]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
