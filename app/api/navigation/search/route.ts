import { NextResponse } from 'next/server';
import { verifyRendererApiRequest } from '@/lib/navigation/rendererAuth';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!verifyRendererApiRequest(request)) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED_RENDERER', message: 'A trusted AgentMatrix renderer is required.' } }, { status: 401 });
  }
  return NextResponse.json(
    {
      error: {
        code: 'REPOSITORY_SEARCH_DISABLED',
        message: 'Repository and symbol search are temporarily disabled.',
      },
    },
    { status: 410 },
  );
}
