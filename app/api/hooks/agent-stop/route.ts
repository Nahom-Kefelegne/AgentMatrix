import { NextResponse } from 'next/server';
import { SOCKET_EVENTS } from '@/lib/types';
import { removeAgent, getSession, markAgentTypeExited } from '@/lib/state/sessionStore';
import { emitToClients } from '@/lib/state/socketEmitter';

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    console.log('[agent-stop] PAYLOAD:', JSON.stringify(payload));
    const parentSessionId = payload.parent_session_id || payload.session_id;
    const agentType = payload.agent_type || '';

    // Mark this agent type as exited so re-spawns during shutdown are ignored
    if (agentType) {
      markAgentTypeExited(parentSessionId, agentType);
    }

    removeAgent(parentSessionId, payload.agent_id);

    emitToClients(SOCKET_EVENTS.AGENT_STOP, {
      sessionId: parentSessionId,
      agentId: payload.agent_id,
    });

    // If all agents are gone, end the meeting
    const parentSession = getSession(parentSessionId);
    if (parentSession && parentSession.agents.length === 0) {
      emitToClients(SOCKET_EVENTS.SESSION_UPDATE, {
        sessionId: parentSessionId,
        changes: { status: 'idle', teamId: undefined },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[agent-stop]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
