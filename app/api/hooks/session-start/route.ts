import { NextResponse } from 'next/server';
import { SOCKET_EVENTS } from '@/lib/types';
import { getSession, updateSession } from '@/lib/state/sessionStore';
import { emitToClients } from '@/lib/state/socketEmitter';
import { checkForRename } from '@/lib/state/sessionName';
import { setCachedName } from '@/lib/state/nameCache';

export async function POST(request: Request) {
  try {
    const payload = await request.json();

    // Don't create sessions from hooks — the scanner handles discovery.
    // Only update the name if a /rename was detected (don't overwrite with slug/cwd).
    const session = getSession(payload.session_id);
    if (session && payload.transcript_path) {
      const renamed = checkForRename(payload.transcript_path);
      if (renamed && renamed !== session.name) {
        updateSession(payload.session_id, { name: renamed });
        setCachedName(payload.session_id, renamed);
        emitToClients(SOCKET_EVENTS.SESSION_UPDATE, {
          sessionId: payload.session_id,
          changes: { name: renamed },
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[session-start]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
