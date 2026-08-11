import { NextResponse } from 'next/server';
import { setCachedName } from '@/lib/state/nameCache';
import { updateSession, getSession } from '@/lib/state/sessionStore';
import { getProvider } from '@/lib/cli';
import { emitToClients } from '@/lib/state/socketEmitter';
import { setActiveSessionName } from '@/lib/state/activeSessionsCache';
import { SOCKET_EVENTS } from '@/lib/types';
import type { CliType } from '@/lib/types';
import { verifyRendererApiRequest } from '@/lib/navigation/rendererAuth';

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export async function POST(request: Request) {
  if (!verifyRendererApiRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized renderer.' }, { status: 401 });
  }
  try {
    const body = await request.json() as Record<string, unknown>;
    const unknownFields = Object.keys(body).filter(
      field => !['sessionId', 'name', 'cliType'].includes(field),
    );
    if (unknownFields.length > 0) {
      return NextResponse.json({ error: `Unsupported field: ${unknownFields[0]}` }, { status: 400 });
    }
    const { sessionId, name, cliType } = body;

    if (typeof sessionId !== 'string' || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'Missing sessionId or name' }, { status: 400 });
    }

    const trimmed = name.trim();
    if (trimmed.length > 100 || CONTROL_CHARACTERS.test(trimmed)) {
      return NextResponse.json({ error: 'Name must be 100 characters or fewer.' }, { status: 400 });
    }
    if (cliType !== undefined && cliType !== 'claude' && cliType !== 'copilot') {
      return NextResponse.json({ error: 'Invalid cliType.' }, { status: 400 });
    }

    // Persist the rename at the CLI's own storage layer so it survives resume
    // and discovery. Provider-owned: Copilot writes workspace.yaml; Claude is a
    // no-op here (its rename is the in-TUI `/rename` the client injects).
    const session = getSession(sessionId);
    const resolvedCli: CliType = cliType as CliType | undefined || session?.cliType || 'claude';
    let providerRenamed = false;
    try {
      providerRenamed = getProvider(resolvedCli).renameSession(sessionId, trimmed);
    } catch (err) {
      console.error('[sessions/rename] provider rename failed', err);
      if (resolvedCli === 'copilot') {
        return NextResponse.json(
          { error: 'Copilot did not accept the session rename.' },
          { status: 409 },
        );
      }
    }
    if (resolvedCli === 'copilot' && !providerRenamed) {
      return NextResponse.json(
        { error: 'Copilot session metadata could not be renamed.' },
        { status: 409 },
      );
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
