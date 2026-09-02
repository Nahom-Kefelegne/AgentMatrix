import { NextResponse } from 'next/server';
import { verifyRendererApiRequest } from '@/lib/navigation/rendererAuth';
import {
  acquireReviewSnapshot,
  releaseReviewSnapshot,
  renewReviewSnapshotLease,
} from '@/lib/review/snapshotStore';

export const runtime = 'nodejs';

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
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('invalid body');
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: { code: 'INVALID_REVIEW_LEASE', message: 'Lease body must be an object.' } },
      { status: 400 },
    );
  }
  const unknown = Object.keys(body).filter(key =>
    !['sessionId', 'snapshotRef', 'action', 'leaseId'].includes(key));
  if (
    unknown.length > 0
    || typeof body.sessionId !== 'string'
    || typeof body.snapshotRef !== 'string'
    || !['acquire', 'renew', 'release'].includes(body.action as string)
  ) {
    return NextResponse.json(
      { error: { code: 'INVALID_REVIEW_LEASE', message: 'Lease request is invalid.' } },
      { status: 400 },
    );
  }
  if (body.action === 'release') {
    if (typeof body.leaseId === 'string') {
      releaseReviewSnapshot(body.sessionId, body.snapshotRef, body.leaseId);
    }
    return NextResponse.json({ ok: true });
  }
  if (body.action === 'renew') {
    const renewed = typeof body.leaseId === 'string'
      && renewReviewSnapshotLease(
        body.sessionId,
        body.snapshotRef,
        body.leaseId,
      );
    return renewed
      ? NextResponse.json({ ok: true })
      : NextResponse.json(
          { error: { code: 'SNAPSHOT_EXPIRED', message: 'This review lease is no longer available.' } },
          { status: 410 },
        );
  }
  const leaseId = acquireReviewSnapshot(body.sessionId, body.snapshotRef);
  if (!leaseId) {
    return NextResponse.json(
      {
        error: {
          code: 'SNAPSHOT_EXPIRED',
          message: 'This review snapshot is no longer available.',
        },
      },
      { status: 410 },
    );
  }
  return NextResponse.json({ ok: true, leaseId });
}
