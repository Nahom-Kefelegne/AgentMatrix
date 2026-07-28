import { NextResponse } from 'next/server';
import { getNavigationService, NavigationServiceError } from '@/lib/navigation/NavigationService';
import { verifyRendererApiRequest } from '@/lib/navigation/rendererAuth';

export const runtime = 'nodejs';

function errorResponse(error: unknown): NextResponse {
  if (error instanceof NavigationServiceError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  console.error('[navigation:resolve-document-link]', error);
  return NextResponse.json(
    { error: { code: 'INTERNAL_ERROR', message: 'Unable to resolve document link.' } },
    { status: 500 },
  );
}

export async function POST(request: Request) {
  if (!verifyRendererApiRequest(request)) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED_RENDERER', message: 'A trusted AgentMatrix renderer is required.' } },
      { status: 401 },
    );
  }
  try {
    const body = await request.json() as {
      sessionId?: unknown;
      documentPath?: unknown;
      raw?: unknown;
    };
    if (
      typeof body.sessionId !== 'string'
      || typeof body.documentPath !== 'string'
      || typeof body.raw !== 'string'
    ) {
      return NextResponse.json(
        { error: { code: 'INVALID_REQUEST', message: 'sessionId, documentPath, and raw are required.' } },
        { status: 400 },
      );
    }
    const result = await getNavigationService().resolveDocumentLink(
      body.sessionId,
      body.documentPath,
      body.raw,
      request.signal,
    );
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
