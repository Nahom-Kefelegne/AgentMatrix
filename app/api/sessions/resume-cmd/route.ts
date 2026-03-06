import { NextResponse } from 'next/server';
import { getSession } from '@/lib/state/sessionStore';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('id');

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }

    const session = getSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const cwd = session.cwd || '~';
    const name = session.name;
    const command = `cd ${cwd} && agency claude --dangerously-skip-permissions --resume ${name}`;

    return NextResponse.json({ command, cwd, name });
  } catch (error) {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
