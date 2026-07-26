import { NextResponse } from 'next/server';
import { getNavigationService, NavigationServiceError } from '@/lib/navigation/NavigationService';
import { verifyRendererApiRequest } from '@/lib/navigation/rendererAuth';

export const runtime = 'nodejs';

function optionalPositiveInteger(value: string | null, name: string): number | undefined {
  if (value === null) return undefined;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new NavigationServiceError('INVALID_RANGE', `${name} must be a positive integer.`);
  }
  return Number(value);
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof NavigationServiceError) {
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  }
  console.error('[navigation:file]', error);
  return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Unable to read navigation file.' } }, { status: 500 });
}

export async function GET(request: Request) {
  if (!verifyRendererApiRequest(request)) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED_RENDERER', message: 'A trusted AgentMatrix renderer is required.' } }, { status: 401 });
  }
  try {
    const params = new URL(request.url).searchParams;
    const sessionId = params.get('sessionId');
    const filePath = params.get('path');
    if (!sessionId || !filePath) {
      return NextResponse.json({ error: { code: 'INVALID_REQUEST', message: 'sessionId and path are required.' } }, { status: 400 });
    }
    const file = await getNavigationService().readFile(sessionId, filePath, {
      startLine: optionalPositiveInteger(params.get('startLine'), 'startLine'),
      startColumn: optionalPositiveInteger(params.get('startColumn'), 'startColumn'),
      endLine: optionalPositiveInteger(params.get('endLine'), 'endLine'),
      endColumn: optionalPositiveInteger(params.get('endColumn'), 'endColumn'),
    }, request.signal);
    return NextResponse.json(file);
  } catch (error) {
    return errorResponse(error);
  }
}
