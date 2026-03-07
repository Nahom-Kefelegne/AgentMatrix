import { NextResponse } from 'next/server';
import { setCachedName } from '@/lib/state/nameCache';
import { updateSession, getSession } from '@/lib/state/sessionStore';
import { emitToClients } from '@/lib/state/socketEmitter';
import { SOCKET_EVENTS } from '@/lib/types';

export async function POST(request: Request) {
  try {
    const { sessionId, name } = await request.json();

    if (!sessionId || !name?.trim()) {
      return NextResponse.json({ error: 'Missing sessionId or name' }, { status: 400 });
    }

    const trimmed = name.trim();

    // Update the persistent cache
    setCachedName(sessionId, trimmed);

    // Update the in-memory session store
    const session = getSession(sessionId);
    if (session) {
      updateSession(sessionId, { name: trimmed });
      emitToClients(SOCKET_EVENTS.SESSION_UPDATE, {
        sessionId,
        changes: { name: trimmed },
      });
    }

    return NextResponse.json({ ok: true, name: trimmed });
  } catch (error) {
    console.error('[sessions/rename]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
