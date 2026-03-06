import { NextResponse } from 'next/server';
import type { SessionData } from '@/lib/types';
import { SOCKET_EVENTS } from '@/lib/types';
import { DESK_POSITIONS, OVERFLOW_POSITIONS, ENTRANCE_POINT, CHARACTER_COLORS } from '@/lib/constants';
import { addSession, getSession, getNextDeskIndex, getAllSessions } from '@/lib/state/sessionStore';
import { emitToClients } from '@/lib/state/socketEmitter';
import { resolveSessionName } from '@/lib/state/sessionName';

export async function POST(request: Request) {
  try {
    const payload = await request.json();

    // Skip if scanner already added this session
    if (getSession(payload.session_id)) {
      return NextResponse.json({ ok: true });
    }

    const deskIndex = getNextDeskIndex();

    const isDesk = deskIndex < DESK_POSITIONS.length;
    const isOverflow = !isDesk && deskIndex < DESK_POSITIONS.length + OVERFLOW_POSITIONS.length;
    const deskPosition = isDesk
      ? DESK_POSITIONS[deskIndex]
      : isOverflow
        ? OVERFLOW_POSITIONS[deskIndex - DESK_POSITIONS.length]
        : ENTRANCE_POINT;

    const colorIndex = getAllSessions().length % CHARACTER_COLORS.length;
    const name = resolveSessionName(payload.transcript_path, payload.cwd, payload.session_id);

    const session: SessionData = {
      id: payload.session_id,
      name,
      color: CHARACTER_COLORS[colorIndex],
      status: 'idle',
      deskIndex,
      deskPosition,
      spawnPosition: ENTRANCE_POINT,
      recentActions: [],
      agents: [],
      cwd: payload.cwd,
      createdAt: Date.now(),
    };

    addSession(session);
    emitToClients(SOCKET_EVENTS.SESSION_START, session);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[session-start]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
