import { NextResponse } from 'next/server';
import type { AgentData } from '@/lib/types';
import { SOCKET_EVENTS } from '@/lib/types';
import { CHARACTER_COLORS, MEETING_POSITIONS } from '@/lib/constants';
import { addAgent, getSession, getAllSessions, isAgentTypeExited, registerAgentId, updateSession } from '@/lib/state/sessionStore';
import { emitToClients } from '@/lib/state/socketEmitter';

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const parentSessionId = payload.parent_session_id || payload.session_id;
    const agentType = payload.agent_type || '';
    const agentName = payload.agent_name || agentType || `Agent-${payload.agent_id.slice(0, 6)}`;

    // Skip if this agent type was recently stopped for this parent (shutdown handshake re-fires)
    if (agentType && isAgentTypeExited(parentSessionId, agentType)) {
      return NextResponse.json({ ok: true });
    }

    const parentSession = getSession(parentSessionId);
    const colorIndex = getAllSessions().reduce((sum, s) => sum + s.agents.length, 0) % CHARACTER_COLORS.length;
    const agentIndex = parentSession ? parentSession.agents.length : 0;
    const position = MEETING_POSITIONS[agentIndex % MEETING_POSITIONS.length];

    const agent: AgentData = {
      id: payload.agent_id,
      name: agentName,
      parentSessionId,
      teamName: payload.team_name,
      color: CHARACTER_COLORS[colorIndex],
      status: 'working',
      position,
      createdAt: Date.now(),
    };

    addAgent(parentSessionId, agent);
    registerAgentId(payload.agent_id, agentName);
    const parentChanges = {
      status: 'working' as const,
      lastActivity: Date.now(),
      ...(payload.team_name ? { teamId: payload.team_name } : {}),
    };
    updateSession(parentSessionId, parentChanges);
    emitToClients(SOCKET_EVENTS.SESSION_UPDATE, {
      sessionId: parentSessionId,
      changes: parentChanges,
    });

    emitToClients(SOCKET_EVENTS.AGENT_START, {
      sessionId: parentSessionId,
      agent,
    });

    if (payload.team_name && parentSession) {
      const participantIds = [parentSessionId, ...parentSession.agents.map((a) => a.id)];
      emitToClients(SOCKET_EVENTS.MEETING_START, {
        teamId: payload.team_name,
        participantIds,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[agent-start]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
