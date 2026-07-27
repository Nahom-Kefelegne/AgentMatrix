import { NextResponse } from 'next/server';
import type { StopPayload } from '@/lib/types';
import { SOCKET_EVENTS } from '@/lib/types';
import { getSession, updateSession } from '@/lib/state/sessionStore';
import { emitToClients } from '@/lib/state/socketEmitter';
import { refreshSessionContextUsage } from '@/lib/state/contextUsage';

export async function POST(request: Request) {
  try {
    const payload: StopPayload = await request.json();

    // Don't clear a pending "needs you" state on turn-end. When Copilot asks a
    // question (AskUserQuestion) or calls request_attention, PostToolUse + Stop
    // fire immediately while it waits for the user. Downgrading to idle here
    // would hide that the session needs the user. Attention clears when the
    // user acts (their next prompt flips the session back to 'working').
    const session = getSession(payload.session_id);
    void refreshSessionContextUsage(payload.session_id).catch(error => {
      console.warn(`[stop] Context refresh failed for ${payload.session_id.slice(0, 8)}:`, error);
    });
    if (session?.status === 'attention' || session?.status === 'done') {
      return NextResponse.json({ ok: true });
    }

    updateSession(payload.session_id, {
      status: 'idle',
      currentTool: undefined,
      lastToolSummary: undefined,
    });

    emitToClients(SOCKET_EVENTS.SESSION_UPDATE, {
      sessionId: payload.session_id,
      changes: { status: 'idle', currentTool: undefined, lastToolSummary: undefined },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[stop]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
