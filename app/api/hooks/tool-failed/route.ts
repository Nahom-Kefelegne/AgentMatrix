import { NextResponse } from 'next/server';
import { SOCKET_EVENTS } from '@/lib/types';
import { getSession, updateSession, addAction } from '@/lib/state/sessionStore';
import { emitToClients } from '@/lib/state/socketEmitter';

/**
 * Copilot `PostToolUseFailure` hook. Fires when a tool errors out. Records a
 * distinct failed action in the session's recent-activity feed (prefixed so the
 * UI can show it as a failure) and clears the "currently running" tool.
 */
export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const sessionId = payload.session_id || payload.sessionId;
    if (!sessionId || !getSession(sessionId)) return NextResponse.json({ ok: true });

    const toolName = payload.tool_name || payload.toolName || 'tool';
    const errMsg = String(payload.error || 'failed').slice(0, 80);
    const summary = `Failed: ${toolName} — ${errMsg}`;

    addAction(sessionId, { toolName, summary, timestamp: Date.now() });
    const changes = { currentTool: undefined, lastActivity: Date.now() };
    updateSession(sessionId, changes);

    emitToClients(SOCKET_EVENTS.TOOL_COMPLETE, { sessionId, toolName, summary });
    const updated = getSession(sessionId);
    if (updated) {
      emitToClients(SOCKET_EVENTS.SESSION_UPDATE, {
        sessionId,
        changes: { recentActions: updated.recentActions, ...changes },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[tool-failed]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
