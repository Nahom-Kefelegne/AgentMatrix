import { NextResponse } from 'next/server';
import type { AgentStopPayload } from '@/lib/types';
import { SOCKET_EVENTS } from '@/lib/types';
import { removeAgent } from '@/lib/state/sessionStore';
import { emitToClients } from '@/lib/state/socketEmitter';

export async function POST(request: Request) {
  try {
    const payload: AgentStopPayload = await request.json();

    removeAgent(payload.session_id, payload.agent_id);

    emitToClients(SOCKET_EVENTS.AGENT_STOP, {
      sessionId: payload.session_id,
      agentId: payload.agent_id,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[agent-stop]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
