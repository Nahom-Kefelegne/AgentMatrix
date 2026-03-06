import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { openSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

export async function POST(request: Request) {
  try {
    const { task, cwd, name } = await request.json();

    if (!task || !cwd) {
      return NextResponse.json({ error: 'Missing task or cwd' }, { status: 400 });
    }

    const sessionName = name || `task-${Date.now()}`;
    // Use --print for non-interactive mode, skip permissions
    const args = ['--print', '--dangerously-skip-permissions', task];

    const logFile = join(tmpdir(), `claude-spawn-${sessionName}.log`);
    const out = openSync(logFile, 'a');

    // Strip CLAUDECODE env to prevent "nested session" error
    const env = { ...process.env };
    delete env.CLAUDECODE;

    const child = spawn('claude', args, {
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
