import { NextResponse } from 'next/server';
import type { AgentStartPayload, AgentData } from '@/lib/types';
import { SOCKET_EVENTS } from '@/lib/types';
import { CHARACTER_COLORS, MEETING_POSITIONS } from '@/lib/constants';
import { addAgent, getSession, getAllSessions } from '@/lib/state/sessionStore';
import { emitToClients } from '@/lib/state/socketEmitter';

export async function POST(request: Request) {
  try {
    const payload: AgentStartPayload = await request.json();
    const parentSessionId = payload.parent_session_id || payload.session_id;
    const parentSession = getSession(parentSessionId);

    const colorIndex = getAllSessions().reduce((sum, s) => sum + s.agents.length, 0) % CHARACTER_COLORS.length;
    const agentIndex = parentSession ? parentSession.agents.length : 0;
    const position = MEETING_POSITIONS[agentIndex % MEETING_POSITIONS.length];

    const agent: AgentData = {
      id: payload.agent_id,
      name: payload.agent_name || `Agent ${payload.agent_id.slice(0, 6)}`,
      parentSessionId,
      teamName: payload.team_name,
      color: CHARACTER_COLORS[colorIndex],
      status: 'working',
      position,
      createdAt: Date.now(),
    };

    addAgent(parentSessionId, agent);

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
