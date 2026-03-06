import { NextResponse } from 'next/server';
import { SOCKET_EVENTS } from '@/lib/types';
import { getSession, updateSession } from '@/lib/state/sessionStore';
import { emitToClients } from '@/lib/state/socketEmitter';
import { resolveSessionName } from '@/lib/state/sessionName';

export async function POST(request: Request) {
  try {
    const payload = await request.json();

    // Don't create sessions from hooks — the scanner handles discovery.
    // Only update the name if we can resolve a better one.
    const session = getSession(payload.session_id);
    if (session && payload.transcript_path) {
      const betterName = resolveSessionName(payload.transcript_path, payload.cwd, payload.session_id);
      if (betterName !== session.name && !betterName.startsWith('Session-')) {
        updateSession(payload.session_id, { name: betterName });
        emitToClients(SOCKET_EVENTS.SESSION_UPDATE, {
          sessionId: payload.session_id,
          changes: { name: betterName },
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[session-start]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
