import { NextResponse } from 'next/server';
import { SOCKET_EVENTS } from '@/lib/types';
import { getSession, updateSession } from '@/lib/state/sessionStore';
import { emitToClients } from '@/lib/state/socketEmitter';
import { refreshSessionContextUsage } from '@/lib/state/contextUsage';

/**
 * Copilot `PreCompact` hook. Fires just before context compaction. Shows a
 * transient "Compacting context…" indicator as the current activity so the user
 * understands the brief pause (and it pairs with the context-usage bar, which
 * drops after compaction).
 */
export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const sessionId = payload.session_id || payload.sessionId;
    if (!sessionId || !getSession(sessionId)) return NextResponse.json({ ok: true });

    const trigger = payload.trigger === 'manual' ? 'manual' : 'auto';
    const changes = {
      status: 'working' as const,
      lastToolSummary: `Compacting context (${trigger})…`,
      lastActivity: Date.now(),
    };
    updateSession(sessionId, changes);
    emitToClients(SOCKET_EVENTS.SESSION_UPDATE, { sessionId, changes });
    void refreshSessionContextUsage(sessionId).catch(error => {
      console.warn(`[pre-compact] Context refresh failed for ${sessionId.slice(0, 8)}:`, error);
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[pre-compact]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
