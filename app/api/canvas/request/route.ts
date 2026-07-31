import { NextResponse } from 'next/server';
import { createCanvasRequest, emitCanvasRequested } from '@/lib/canvas/requests';
import {
  isCanvasRenderedKind,
  type CanvasRequestDelivery,
} from '@/lib/canvas/types';
import { NavigationServiceError } from '@/lib/navigation/NavigationService';
import { verifyNavigationCapability } from '@/lib/navigation/rootRegistry';
import { getSession } from '@/lib/state/sessionStore';

export const runtime = 'nodejs';

function errorResponse(error: unknown): NextResponse {
  if (error instanceof NavigationServiceError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  console.error('[canvas:request]', error);
  return NextResponse.json(
    { error: { code: 'INTERNAL_ERROR', message: 'Unable to accept Canvas request.' } },
    { status: 500 },
  );
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
    if (body.sessionId !== undefined) {
      return NextResponse.json(
        { error: { code: 'SESSION_ID_FORBIDDEN', message: 'MCP session identity is supplied by its process, not tool arguments.' } },
        { status: 403 },
      );
    }
    const unknownBodyFields = Object.keys(body).filter(key => key !== 'kind' && key !== 'args');
    if (unknownBodyFields.length > 0) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_CANVAS_REQUEST',
            message: `Request contains unsupported field${unknownBodyFields.length === 1 ? '' : 's'}: ${unknownBodyFields.join(', ')}.`,
          },
        },
        { status: 400 },
      );
    }

    const canvasRequest = await createCanvasRequest({
      sessionId,
      kind: body.kind,
      args: body.args,
      signal: request.signal,
    });
    if (
      !getSession(sessionId)
      || !verifyNavigationCapability(sessionId, capability)
    ) {
      return NextResponse.json(
        { error: { code: 'SESSION_ENDED', message: 'The managed session ended before the Canvas request was accepted.' } },
        { status: 410 },
      );
    }

    const delivery: CanvasRequestDelivery =
      isCanvasRenderedKind(canvasRequest.kind)
        ? 'canvas_renderer'
        : 'event_only';

    const result = emitCanvasRequested(canvasRequest, delivery);
    return NextResponse.json({ request: canvasRequest, result }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
