import { NextResponse } from 'next/server';
import { SOCKET_EVENTS } from '@/lib/types';
import { removeAgent, removeAgentByName, getSession, markAgentTypeExited, getAgentName, updateSession } from '@/lib/state/sessionStore';
import { emitToClients } from '@/lib/state/socketEmitter';

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const parentSessionId = payload.parent_session_id || payload.session_id;
    const agentType = payload.agent_type || '';

    // Mark this agent type as exited so re-spawns during shutdown are ignored
    if (agentType) {
      markAgentTypeExited(parentSessionId, agentType);
    }

    const agentName = getAgentName(payload.agent_id) || agentType;

    // Remove from store
    removeAgent(parentSessionId, payload.agent_id);
    const characterId = removeAgentByName(parentSessionId, agentName);

    const emitAgentId = characterId || payload.agent_id;
    emitToClients(SOCKET_EVENTS.AGENT_STOP, {
      sessionId: parentSessionId,
      agentId: emitAgentId,
      agentName,
    });

    // If all agents are gone, end the meeting presentation but keep the parent
    // working. Subagent completion is still inside the parent's agent turn;
    // only Stop may transition the session back to idle.
    const parentSession = getSession(parentSessionId);
    if (parentSession && parentSession.agents.length === 0) {
      updateSession(parentSessionId, { teamId: undefined });
      emitToClients(SOCKET_EVENTS.SESSION_UPDATE, {
        sessionId: parentSessionId,
        changes: { teamId: undefined },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[agent-stop]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
