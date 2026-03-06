import { NextResponse } from 'next/server';
import { execSync } from 'child_process';
import { getSession } from '@/lib/state/sessionStore';

export async function POST(request: Request) {
  try {
    const { sessionId } = await request.json();
    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
    }

    const session = getSession(sessionId);
    const cwd = session?.cwd || '~';
    const name = session?.name || sessionId.slice(0, 8);

    // Kill the process
    try {
      const output = execSync(
        `ps aux | grep '[c]laude.*--session-id ${sessionId}' | awk '{print $2}'`,
        { encoding: 'utf-8', timeout: 5000 },
      ).trim();
      for (const pid of output.split('\n').filter(Boolean)) {
        try { execSync(`kill ${pid}`, { timeout: 5000 }); } catch {}
      }
    } catch {}

    const command = `cd ${cwd} && agency claude --dangerously-skip-permissions --resume ${name}`;
    return NextResponse.json({ ok: true, command, cwd, name });
  } catch (error) {
    console.error('[sessions/restart]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
