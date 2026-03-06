import { NextResponse } from 'next/server';
import { spawn } from 'child_process';

export async function POST(request: Request) {
  try {
    const { task, cwd, name } = await request.json();

    if (!task || !cwd) {
      return NextResponse.json({ error: 'Missing task or cwd' }, { status: 400 });
    }

    const args = ['-p', task, '--dangerously-skip-permissions'];

    // If a name is provided, use --resume so the session is resumable by name
    if (name) {
      args.push('--resume', name);
    }

    const child = spawn('claude', args, {
      cwd,
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore'],
    });

    child.unref();

    return NextResponse.json({ ok: true, name: name || null });
  } catch (error) {
    console.error('[sessions/spawn]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
