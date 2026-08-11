import { NextResponse } from 'next/server';
import {
  submitCanvasDecisionResponse,
  type CanvasDecisionResponseInput,
} from '@/lib/canvas/decisionResponses';
import { NavigationServiceError } from '@/lib/navigation/NavigationService';
import { verifyRendererApiRequest } from '@/lib/navigation/rendererAuth';

export const runtime = 'nodejs';

const ALLOWED_FIELDS = new Set([
  'sessionId',
  'requestRef',
  'optionId',
  'customAnswer',
]);

function errorResponse(error: unknown): NextResponse {
  if (error instanceof NavigationServiceError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  console.error('[canvas:decision]', error);
  return NextResponse.json(
    {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Unable to deliver the decision response.',
      },
    },
    { status: 500 },
  );
}

export async function POST(request: Request) {
  if (!verifyRendererApiRequest(request)) {
    return NextResponse.json(
      {
        error: {
          code: 'UNAUTHORIZED_RENDERER',
          message: 'A trusted AgentMatrix renderer is required.',
        },
      },
      { status: 401 },
    );
  }

  try {
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await request.json();
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('not an object');
      }
      body = parsed as Record<string, unknown>;
    } catch {
      throw new NavigationServiceError(
        'INVALID_DECISION_RESPONSE',
        'Decision response body must be a JSON object.',
      );
    }
    const unknownFields = Object.keys(body).filter(field => !ALLOWED_FIELDS.has(field));
    if (unknownFields.length > 0) {
      throw new NavigationServiceError(
        'INVALID_DECISION_RESPONSE',
        `Response contains unsupported field${unknownFields.length === 1 ? '' : 's'}: ${unknownFields.join(', ')}.`,
      );
    }

    const result = await submitCanvasDecisionResponse(
      body as unknown as CanvasDecisionResponseInput,
    );
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
