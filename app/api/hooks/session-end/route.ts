import { NextResponse } from 'next/server';
import type { SessionEndPayload } from '@/lib/types';
import { SOCKET_EVENTS } from '@/lib/types';
import { removeSession } from '@/lib/state/sessionStore';
import { emitToClients } from '@/lib/state/socketEmitter';

export async function POST(request: Request) {
  try {
    const payload: SessionEndPayload = await request.json();

    removeSession(payload.session_id);
    emitToClients(SOCKET_EVENTS.SESSION_END, { sessionId: payload.session_id });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[session-end]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
