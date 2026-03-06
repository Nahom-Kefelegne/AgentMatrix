import { NextResponse } from 'next/server';
import { SOCKET_EVENTS } from '@/lib/types';
import { getSession, updateSession } from '@/lib/state/sessionStore';
import { emitToClients } from '@/lib/state/socketEmitter';
import { resolveSessionName } from '@/lib/state/sessionName';

export async function POST(request: Request) {
  try {
    const payload = await request.json();

    // Try to resolve a better name if current one is just the cwd folder
    const session = getSession(payload.session_id);
    if (session && payload.transcript_path) {
      const resolvedName = resolveSessionName(payload.transcript_path, payload.cwd, payload.session_id);
      if (resolvedName !== session.name && !resolvedName.startsWith('Session-')) {
        updateSession(payload.session_id, { name: resolvedName });
        emitToClients(SOCKET_EVENTS.SESSION_UPDATE, {
          sessionId: payload.session_id,
          changes: { name: resolvedName },
        });
      }
    }

    updateSession(payload.session_id, {
      status: 'working',
      currentTool: payload.tool_name,
    });

    emitToClients(SOCKET_EVENTS.TOOL_START, {
      sessionId: payload.session_id,
      toolName: payload.tool_name,
      toolInput: payload.tool_input ? JSON.stringify(payload.tool_input).slice(0, 200) : undefined,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[tool-use]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
