import { NextResponse } from 'next/server';
import { getSessionInspectorData } from '@/lib/session-inspector/server';
import { verifyRendererApiRequest } from '@/lib/navigation/rendererAuth';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  if (!verifyRendererApiRequest(request)) {
    return NextResponse.json(
      { error: 'A trusted AgentMatrix renderer is required.' },
      { status: 401 },
    );
  }
  const sessionId = new URL(request.url).searchParams.get('sessionId');
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required.' }, { status: 400 });
  }
  const data = getSessionInspectorData(sessionId);
  if (!data) {
    return NextResponse.json({ error: 'Session not found.' }, { status: 404 });
  }
  return NextResponse.json(data);
}
