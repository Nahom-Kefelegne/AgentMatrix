import { NextResponse } from 'next/server';
import { SOCKET_EVENTS } from '@/lib/types';
import { getSession, updateSession } from '@/lib/state/sessionStore';
import { emitToClients } from '@/lib/state/socketEmitter';

/**
 * Copilot `UserPromptSubmit` hook. Fires the instant the user submits a prompt,
 * before the agent processes it — so the dashboard flips the session to
 * "working" immediately instead of waiting for the first tool call.
 */
export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const sessionId = payload.session_id || payload.sessionId;
    if (!sessionId || !getSession(sessionId)) return NextResponse.json({ ok: true });

    const changes = { status: 'working' as const, lastActivity: Date.now() };
    updateSession(sessionId, changes);
    emitToClients(SOCKET_EVENTS.SESSION_UPDATE, { sessionId, changes });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[prompt-submit]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
