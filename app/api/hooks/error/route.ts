import { NextResponse } from 'next/server';
import { SOCKET_EVENTS } from '@/lib/types';
import { getSession, updateSession } from '@/lib/state/sessionStore';
import { emitToClients } from '@/lib/state/socketEmitter';

/**
 * Copilot `ErrorOccurred` hook. Surfaces a runtime error on the session card by
 * flipping it to the "attention" state with the error message as the reason
 * (reuses the existing attention UI — amber card + reason line). Only
 * unrecoverable errors raise attention; recoverable ones are logged only so the
 * card isn't spammed for transient, self-healing failures.
 */
export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const sessionId = payload.session_id || payload.sessionId;
    if (!sessionId || !getSession(sessionId)) return NextResponse.json({ ok: true });

    // `error` may be an object { message, name, stack } or a plain string.
    const err = payload.error;
    const message = typeof err === 'string' ? err : err?.message || 'Unknown error';
    const recoverable = payload.recoverable === true;

    if (recoverable) {
      console.log(`[error] ${sessionId.slice(0, 8)} recoverable: ${message}`);
      return NextResponse.json({ ok: true });
    }

    const changes = {
      status: 'attention' as const,
      statusReason: `Error: ${String(message).slice(0, 120)}`,
      currentTool: undefined,
      lastActivity: Date.now(),
    };
    updateSession(sessionId, changes);
    emitToClients(SOCKET_EVENTS.SESSION_UPDATE, { sessionId, changes });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[error]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
