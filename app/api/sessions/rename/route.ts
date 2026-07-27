import { NextResponse } from 'next/server';
import { setCachedName } from '@/lib/state/nameCache';
import { updateSession, getSession } from '@/lib/state/sessionStore';
import { getProvider } from '@/lib/cli';
import { emitToClients } from '@/lib/state/socketEmitter';
import { setActiveSessionName } from '@/lib/state/activeSessionsCache';
import { SOCKET_EVENTS } from '@/lib/types';
import type { CliType } from '@/lib/types';

export async function POST(request: Request) {
  try {
    const { sessionId, name, cliType } = await request.json();

    if (!sessionId || !name?.trim()) {
      return NextResponse.json({ error: 'Missing sessionId or name' }, { status: 400 });
    }

    const trimmed = name.trim();

    // Persist the rename at the CLI's own storage layer so it survives resume
    // and discovery. Provider-owned: Copilot writes workspace.yaml; Claude is a
    // no-op here (its rename is the in-TUI `/rename` the client injects).
    const session = getSession(sessionId);
    const resolvedCli: CliType = cliType || session?.cliType || 'claude';
    try {
      getProvider(resolvedCli).renameSession(sessionId, trimmed);
    } catch (err) {
      console.error('[sessions/rename] provider rename failed', err);
    }

    // Update the persistent cache (drives the UI display for both CLIs)
    setCachedName(sessionId, trimmed);
    setActiveSessionName(sessionId, trimmed);

    // Update the in-memory session store
    if (session) {
      updateSession(sessionId, { name: trimmed });
      emitToClients(SOCKET_EVENTS.SESSION_UPDATE, {
        sessionId,
        changes: { name: trimmed },
      });
    }

    return NextResponse.json({ ok: true, name: trimmed });
  } catch (error) {
    console.error('[sessions/rename]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
