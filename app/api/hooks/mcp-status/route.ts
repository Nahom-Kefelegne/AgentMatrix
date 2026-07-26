import { NextResponse } from 'next/server';
import { SOCKET_EVENTS } from '@/lib/types';
import { getSession, updateSession } from '@/lib/state/sessionStore';
import { emitToClients } from '@/lib/state/socketEmitter';
import { verifyNavigationCapability } from '@/lib/navigation/rootRegistry';
import { verifyRendererApiRequest } from '@/lib/navigation/rendererAuth';

export async function POST(request: Request) {
  try {
    const { tool, reason, summary, sessionId } = await request.json();

    if (tool === '__clear_status') {
      if (!verifyRendererApiRequest(request) || typeof sessionId !== 'string') {
        return NextResponse.json({ error: 'Unauthorized renderer status update' }, { status: 401 });
      }
      const session = getSession(sessionId);
      if (!session) return NextResponse.json({ error: 'No session found' }, { status: 404 });
      if (session.status === 'done' || session.status === 'attention') {
        const changes = { status: 'idle' as const, statusReason: undefined };
        updateSession(sessionId, changes);
        emitToClients(SOCKET_EVENTS.SESSION_UPDATE, { sessionId, changes });
        console.log(`[mcp-status] Session ${sessionId.slice(0, 8)} → cleared to idle`);
      }
      return NextResponse.json({ ok: true, status: 'idle' });
    }

    const sid = request.headers.get('x-agentmatrix-session-id');
    const capability = request.headers.get('x-agentmatrix-capability');
    if (!sid || !verifyNavigationCapability(sid, capability)) {
      return NextResponse.json({ error: 'Unauthorized managed MCP identity' }, { status: 401 });
    }

    if (!getSession(sid)) {
      return NextResponse.json({ error: 'No session found' }, { status: 404 });
    }
    if (tool === 'request_attention' && (typeof reason !== 'string' || !reason.trim() || reason.length > 1_000)) {
      return NextResponse.json({ error: 'reason must be a non-empty string of 1000 characters or fewer' }, { status: 400 });
    }
    if (tool === 'work_complete' && (typeof summary !== 'string' || !summary.trim() || summary.length > 1_000)) {
      return NextResponse.json({ error: 'summary must be a non-empty string of 1000 characters or fewer' }, { status: 400 });
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
