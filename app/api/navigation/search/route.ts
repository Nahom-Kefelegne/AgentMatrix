import { NextResponse } from 'next/server';
import { getNavigationService, NavigationServiceError } from '@/lib/navigation/NavigationService';
import { verifyRendererApiRequest } from '@/lib/navigation/rendererAuth';

export const runtime = 'nodejs';

function errorResponse(error: unknown): NextResponse {
  if (error instanceof NavigationServiceError) {
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  }
  console.error('[navigation:search]', error);
  return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Unable to search the session repository.' } }, { status: 500 });
}

export async function POST(request: Request) {
  if (!verifyRendererApiRequest(request)) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED_RENDERER', message: 'A trusted AgentMatrix renderer is required.' } }, { status: 401 });
  }
  try {
    let body: {
      sessionId?: unknown;
      query?: unknown;
      mode?: unknown;
      scope?: unknown;
      stream?: unknown;
    };
    try {
      body = await request.json();
    } catch {
      if (request.signal.aborted) return new Response(null, { status: 499 });
      return NextResponse.json(
        { error: { code: 'INVALID_JSON', message: 'Search request body must be valid JSON.' } },
        { status: 400 },
      );
    }
    if (typeof body.sessionId !== 'string' || typeof body.query !== 'string') {
      return NextResponse.json({ error: { code: 'INVALID_REQUEST', message: 'sessionId and query are required.' } }, { status: 400 });
    }
    if (body.mode !== 'content' && body.mode !== 'symbol') {
      return NextResponse.json({ error: { code: 'INVALID_MODE', message: 'mode must be content or symbol.' } }, { status: 400 });
    }
    if (body.scope !== undefined && typeof body.scope !== 'string') {
      return NextResponse.json({ error: { code: 'INVALID_SCOPE', message: 'scope must be a repository-relative path.' } }, { status: 400 });
    }
    if (body.stream === true) {
      const encoder = new TextEncoder();
      const abortController = new AbortController();
      const abort = () => abortController.abort();
      let streamClosed = false;
      request.signal.addEventListener('abort', abort, { once: true });
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const enqueue = (value: unknown) => {
            if (streamClosed) return;
            try {
              controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
            } catch {
              streamClosed = true;
              abortController.abort();
            }
          };
          const close = () => {
            if (streamClosed) return;
            streamClosed = true;
            try { controller.close(); } catch { /* cancelled by client */ }
          };
          void getNavigationService().search(body.sessionId as string, body.query as string, {
            mode: body.mode as 'content' | 'symbol',
            scope: body.scope as string | undefined,
            signal: abortController.signal,
            onBatch: matches => {
              enqueue({ type: 'batch', matches });
            },
          }).then(result => {
            enqueue({
              type: 'done',
              result: { ...result, matches: [] },
            });
            close();
          }).catch(error => {
            if (abortController.signal.aborted) {
              close();
              return;
            }
            const payload = error instanceof NavigationServiceError
              ? { code: error.code, message: error.message }
              : { code: 'INTERNAL_ERROR', message: 'Unable to search the session repository.' };
            enqueue({ type: 'error', error: payload });
            close();
          }).finally(() => {
            request.signal.removeEventListener('abort', abort);
          });
        },
        cancel() {
          streamClosed = true;
          abortController.abort();
          request.signal.removeEventListener('abort', abort);
        },
      });
      return new Response(stream, {
        headers: {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    }

    const result = await getNavigationService().search(body.sessionId, body.query, {
      mode: body.mode,
      scope: body.scope,
      signal: request.signal,
    });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
