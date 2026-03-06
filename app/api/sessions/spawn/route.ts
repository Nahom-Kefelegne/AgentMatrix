import { NextResponse } from 'next/server';
import { spawn } from 'child_process';

export async function POST(request: Request) {
  try {
    const { task, cwd } = await request.json();

    if (!task || !cwd) {
      return NextResponse.json({ error: 'Missing task or cwd' }, { status: 400 });
    }

    const child = spawn('claude', ['-p', task, '--dangerously-skip-permissions'], {
      cwd,
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore'],
    });

    child.unref();

    return NextResponse.json({ ok: true, message: 'Session spawned' });
  } catch (error) {
    console.error('[sessions/spawn]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
