import { NextResponse } from 'next/server';
import { getCachedName } from '@/lib/state/nameCache';
import { allProviders, getProvider } from '@/lib/cli';
import type { CliType } from '@/lib/types';

/**
 * Resolve a session ID to its project CWD across all known CLIs.
 * If `cliType` is provided, only that provider is queried. Otherwise
 * every provider is tried in order; the first hit wins.
 *
 * GET /api/sessions/resolve?id=<sessionId>&cliType=claude|copilot
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('id');
    const cliTypeParam = searchParams.get('cliType') as CliType | null;
    if (!sessionId) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }

    const providers = cliTypeParam
      ? [getProvider(cliTypeParam)]
      : allProviders();

    for (const provider of providers) {
      const cwd = provider.findSessionCwd(sessionId);
      if (cwd) {
        const name = getCachedName(sessionId) || `Session-${sessionId.slice(0, 8)}`;
        return NextResponse.json({
          id: sessionId,
          cwd,
          name,
          cliType: provider.type,
        });
      }
    }

    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  } catch (error) {
    console.error('[sessions/resolve]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
