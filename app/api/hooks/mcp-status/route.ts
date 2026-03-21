import { NextResponse } from 'next/server';
import { SOCKET_EVENTS } from '@/lib/types';
import { getSession, updateSession, getAllSessions } from '@/lib/state/sessionStore';
import { emitToClients } from '@/lib/state/socketEmitter';

export async function POST(request: Request) {
  try {
    const { tool, sessionId, reason, summary } = await request.json();

    // Find the session — try direct ID first, then fuzzy match
    let sid = sessionId;
    if (!sid || !getSession(sid)) {
      const all = getAllSessions();
      if (all.length > 0) {
        const sorted = [...all].sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));
        sid = sorted[0].id;
      }
    }

    if (!sid || !getSession(sid)) {
      return NextResponse.json({ error: 'No session found' }, { status: 404 });
    }

    if (tool === 'request_attention') {
      const changes = { status: 'attention' as const, statusReason: reason || 'Needs your input', lastActivity: Date.now() };
      updateSession(sid, changes);
      emitToClients(SOCKET_EVENTS.SESSION_UPDATE, { sessionId: sid, changes });
      console.log(`[mcp-status] Session ${sid.slice(0, 8)} → attention: ${reason}`);
      return NextResponse.json({ ok: true, status: 'attention' });
    }

    if (tool === 'work_complete') {
      const changes = { status: 'done' as const, statusReason: summary || 'Work complete', lastActivity: Date.now() };
      updateSession(sid, changes);
      emitToClients(SOCKET_EVENTS.SESSION_UPDATE, { sessionId: sid, changes });
      console.log(`[mcp-status] Session ${sid.slice(0, 8)} → done: ${summary}`);
      return NextResponse.json({ ok: true, status: 'done' });
    }

    return NextResponse.json({ error: 'Unknown tool' }, { status: 400 });
  } catch (err) {
    console.error('[mcp-status] Error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
