import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { NextResponse } from 'next/server';
import { getNavigationService } from '@/lib/navigation/NavigationService';
import { verifyRendererApiRequest } from '@/lib/navigation/rendererAuth';
import { validateReviewPath } from '@/lib/review/paths';
import { getReviewSnapshotStatusSource } from '@/lib/review/snapshotStore';
import { readIndexEntry } from '@/lib/review/git';
import { MAX_REVIEW_FILE_BYTES } from '@/lib/review/types';

export const runtime = 'nodejs';

function hash(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

export async function GET(request: Request) {
  if (!verifyRendererApiRequest(request)) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED_RENDERER', message: 'A trusted AgentMatrix renderer is required.' } },
      { status: 401 },
    );
  }
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('sessionId');
  const snapshotRef = searchParams.get('snapshotRef');
  if (!sessionId || !snapshotRef) {
    return NextResponse.json(
      { error: { code: 'INVALID_REVIEW_STATUS', message: 'sessionId and snapshotRef are required.' } },
      { status: 400 },
    );
  }
  const source = getReviewSnapshotStatusSource(sessionId, snapshotRef);
  if (!source) {
    return NextResponse.json(
      { error: { code: 'SNAPSHOT_EXPIRED', message: 'This review snapshot is no longer available.' } },
      { status: 410 },
    );
  }
  try {
    const root = await getNavigationService().resolveRoot(sessionId, request.signal);
    let stale = false;
    const changedPaths: string[] = [];
    for (const file of source) {
      if (!file.contentAvailable) continue;
      if (file.contentKind === 'gitlink') {
        const indexEntry = root.isGitRepository
          ? await readIndexEntry(root.absolutePath, file.path, request.signal)
          : null;
        const currentHash = hash(Buffer.from(
          indexEntry?.mode === '160000' ? `${indexEntry.objectId}\n` : '',
        ));
        if (currentHash !== file.currentHash) {
          stale = true;
          changedPaths.push(file.path);
        }
        continue;
      }
      const validated = await validateReviewPath(root.absolutePath, file.path);
      if ((validated.size ?? 0) > MAX_REVIEW_FILE_BYTES) {
        stale = true;
        changedPaths.push(file.path);
        continue;
      }
      const currentHash = validated.exists && !validated.isDirectory
        ? hash(Buffer.from(
            (await readFile(validated.absolutePath)).toString('utf8'),
            'utf8',
          ))
        : hash(Buffer.alloc(0));
      if (currentHash !== file.currentHash) {
        stale = true;
        changedPaths.push(file.path);
      }
    }
    return NextResponse.json({ stale, changedPaths });
  } catch {
    return NextResponse.json({ stale: true, changedPaths: [] });
  }
}
