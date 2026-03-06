import { NextResponse } from 'next/server';
import type { ToolCompletePayload } from '@/lib/types';
import { SOCKET_EVENTS } from '@/lib/types';
import { addAction, updateSession, getSession, getAgentName } from '@/lib/state/sessionStore';
import { emitToClients } from '@/lib/state/socketEmitter';

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const summary = payload.tool_name;

    addAction(payload.session_id, {
      toolName: payload.tool_name,
      summary,
      timestamp: Date.now(),
    });

    const lastActivity = Date.now();

    updateSession(payload.session_id, {
      currentTool: undefined,
      lastActivity,
    });

    const agentName = payload.agent_id ? getAgentName(payload.agent_id) : null;

    emitToClients(SOCKET_EVENTS.TOOL_COMPLETE, {
      sessionId: payload.session_id,
      agentName: agentName || null,
      toolName: payload.tool_name,
      summary,
    });

    const session = getSession(payload.session_id);
    if (session) {
      emitToClients(SOCKET_EVENTS.SESSION_UPDATE, {
        sessionId: payload.session_id,
        changes: {
          currentTool: undefined,
          lastActivity,
          recentActions: session.recentActions,
        },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[tool-complete]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
