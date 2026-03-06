import { NextResponse } from 'next/server';
import { execSync } from 'child_process';
import { emitToClients } from '@/lib/state/socketEmitter';

export async function POST(request: Request) {
  try {
    const { sessionId } = await request.json();

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
    }

    // Emit fired event BEFORE killing so the client plays the animation
    emitToClients('session:fired', { sessionId });

    // Wait a moment then kill (let the animation start)
    setTimeout(() => {
      try {
        const output = execSync(
          `ps aux | grep '[c]laude.*--session-id ${sessionId}' | awk '{print $2}'`,
          { encoding: 'utf-8', timeout: 5000 },
        ).trim();

        for (const pid of output.split('\n').filter(Boolean)) {
          try { execSync(`kill ${pid}`, { timeout: 5000 }); } catch {}
        }
      } catch {}
    }, 3000); // 3s delay — shocked (1s) + packing (1.5s) + buffer

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[sessions/kill]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
