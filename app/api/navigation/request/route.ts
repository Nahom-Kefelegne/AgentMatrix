import { NextResponse } from 'next/server';
import { NavigationServiceError } from '@/lib/navigation/NavigationService';
import { createNavigationRequest, emitNavigationRequested } from '@/lib/navigation/requests';
import { verifyNavigationCapability } from '@/lib/navigation/rootRegistry';
import { getSession } from '@/lib/state/sessionStore';

export const runtime = 'nodejs';

function errorResponse(error: unknown): NextResponse {
  if (error instanceof NavigationServiceError) {
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  }
  console.error('[navigation:request]', error);
  return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Unable to queue navigation request.' } }, { status: 500 });
}

export async function POST(request: Request) {
  try {
    const sessionId = request.headers.get('x-agentmatrix-session-id');
    const capability = request.headers.get('x-agentmatrix-capability');
    if (!sessionId || !verifyNavigationCapability(sessionId, capability)) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED_MCP_IDENTITY', message: 'A managed MCP capability is required.' } },
        { status: 401 },
      );
    }
    if (!getSession(sessionId)) {
      return NextResponse.json(
        { error: { code: 'SESSION_NOT_FOUND', message: 'The managed session is no longer active.' } },
        { status: 404 },
      );
    }
    const body = await request.json() as Record<string, unknown>;
    if (body.sessionId !== undefined && body.sessionId !== sessionId) {
      return NextResponse.json(
        { error: { code: 'SESSION_ID_MISMATCH', message: 'MCP session identity is supplied by its process, not tool arguments.' } },
        { status: 403 },
      );
    }
    const navigation = await createNavigationRequest({
      sessionId,
      forceSource: 'mcp',
      action: body.action,
      target: body.target,
      query: body.query,
      symbolKind: body.symbolKind,
      diff: body.diff,
      presentation: body.presentation,
      summary: body.summary,
      intentKind: 'agent_progress',
      signal: request.signal,
    });
    if (
      !getSession(sessionId)
      || !verifyNavigationCapability(sessionId, capability)
    ) {
      return NextResponse.json(
        { error: { code: 'SESSION_ENDED', message: 'The managed session ended before navigation was accepted.' } },
        { status: 410 },
      );
    }
    const result = emitNavigationRequested(navigation);
    return NextResponse.json({ request: navigation, result }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
