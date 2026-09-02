import { NextResponse } from 'next/server';
import { verifyRendererApiRequest } from '@/lib/navigation/rendererAuth';
import { getReviewSnapshotFile } from '@/lib/review/snapshotStore';

export const runtime = 'nodejs';

export async function GET(request: Request) {
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
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('sessionId');
  const fileId = searchParams.get('fileId');
  if (!sessionId || !fileId || sessionId.length > 200 || fileId.length > 200) {
    return NextResponse.json(
      {
        error: {
          code: 'INVALID_REVIEW_FILE_REQUEST',
          message: 'sessionId and fileId are required.',
        },
      },
      { status: 400 },
    );
  }
  const file = getReviewSnapshotFile(sessionId, fileId);
  if (!file) {
    return NextResponse.json(
      {
        error: {
          code: 'SNAPSHOT_EXPIRED',
          message: 'This review snapshot is no longer available. Ask the session to present a fresh review.',
        },
      },
      { status: 410 },
    );
  }
  return NextResponse.json(file);
}
