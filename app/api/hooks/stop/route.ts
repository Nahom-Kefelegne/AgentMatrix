import { NextResponse } from 'next/server';
import type { StopPayload } from '@/lib/types';
import { SOCKET_EVENTS } from '@/lib/types';
import { updateSession } from '@/lib/state/sessionStore';
import { emitToClients } from '@/lib/state/socketEmitter';

export async function POST(request: Request) {
  try {
    const payload: StopPayload = await request.json();

    updateSession(payload.session_id, {
      status: 'idle',
      currentTool: undefined,
    });

    emitToClients(SOCKET_EVENTS.SESSION_UPDATE, {
      sessionId: payload.session_id,
      changes: { status: 'idle', currentTool: undefined },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[stop]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
