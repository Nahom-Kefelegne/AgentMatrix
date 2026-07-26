import { NextResponse } from 'next/server';
import { getNavigationService, NavigationServiceError } from '@/lib/navigation/NavigationService';
import { emitNavigationRequested } from '@/lib/navigation/requests';
import type { NavigationRequest } from '@/lib/navigation/types';
import { verifyRendererApiRequest } from '@/lib/navigation/rendererAuth';
import { randomUUID } from 'crypto';

export const runtime = 'nodejs';

function errorResponse(error: unknown): NextResponse {
  if (error instanceof NavigationServiceError) {
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  }
  console.error('[navigation:resolve-link]', error);
  return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Unable to resolve terminal link.' } }, { status: 500 });
}

export async function POST(request: Request) {
  if (!verifyRendererApiRequest(request)) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED_RENDERER', message: 'A trusted AgentMatrix renderer is required.' } }, { status: 401 });
  }
  try {
    const body = await request.json() as { sessionId?: unknown; raw?: unknown };
    if (typeof body.sessionId !== 'string' || typeof body.raw !== 'string') {
      return NextResponse.json({ error: { code: 'INVALID_REQUEST', message: 'sessionId and raw are required.' } }, { status: 400 });
    }
    const resolved = await getNavigationService().resolveDeveloperLink(body.sessionId, body.raw, request.signal);
    const navigation: NavigationRequest = {
      protocolVersion: 'agentmatrix.navigation/v1',
      requestRef: randomUUID(),
      sessionId: body.sessionId,
      repoRef: resolved.repoRef,
      action: resolved.range ? 'reveal_range' : 'open_file',
      source: 'terminal_link',
      target: { path: resolved.path, range: resolved.range },
      intent: { kind: 'developer_link', summary: 'Opened terminal file link' },
      createdAt: Date.now(),
    };
    emitNavigationRequested(navigation);
    return NextResponse.json(navigation);
  } catch (error) {
    return errorResponse(error);
  }
}
