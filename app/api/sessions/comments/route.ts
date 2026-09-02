import { NextResponse } from 'next/server';
import { getSession } from '@/lib/state/sessionStore';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import type { ReviewComment } from '@/lib/types';
import { hasReviewSnapshot } from '@/lib/review/snapshotStore';
import { verifyRendererApiRequest } from '@/lib/navigation/rendererAuth';

function commentsForSnapshot(
  comments: ReviewComment[],
  snapshotRef: unknown,
): ReviewComment[] {
  return typeof snapshotRef === 'string'
    ? comments.filter(comment => comment.snapshotRef === snapshotRef)
    : comments.filter(comment => !comment.snapshotRef);
}

function getReviewDir(cwd: string): string {
  return join(cwd, '.claude', 'reviews');
}

function getReviewFile(cwd: string, sessionId: string): string {
  return join(getReviewDir(cwd), `${sessionId}.json`);
}

function loadFromDisk(cwd: string, sessionId: string): ReviewComment[] {
  try {
    const filePath = getReviewFile(cwd, sessionId);
    if (!existsSync(filePath)) return [];
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveToDisk(cwd: string, sessionId: string, comments: ReviewComment[]) {
  try {
    const dir = getReviewDir(cwd);
    mkdirSync(dir, { recursive: true });
    const filePath = getReviewFile(cwd, sessionId);
    if (comments.length === 0) {
      if (existsSync(filePath)) unlinkSync(filePath);
    } else {
      writeFileSync(filePath, JSON.stringify(comments, null, 2), 'utf-8');
    }
  } catch (err) {
    console.error('[comments] Failed to persist:', err);
  }
}

/**
 * GET /api/sessions/comments?sessionId=<id>
 * Returns review comments for a session. Loads from disk if not in memory.
 */
export async function GET(request: Request) {
  if (!verifyRendererApiRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized renderer' }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('sessionId');
  const snapshotRef = searchParams.get('snapshotRef');

  if (!sessionId) {
    return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
  }

  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  if (snapshotRef && !hasReviewSnapshot(sessionId, snapshotRef)) {
    return NextResponse.json(
      { error: 'Review snapshot is no longer available' },
      { status: 410 },
    );
  }

  // Hydrate from disk if not loaded yet
  if (!session.reviewComments && session.cwd) {
    session.reviewComments = loadFromDisk(session.cwd, sessionId);
  }

  return NextResponse.json({
    comments: commentsForSnapshot(session.reviewComments || [], snapshotRef),
  });
}

/**
 * POST /api/sessions/comments
 * Add a comment or clear all comments.
 */
export async function POST(request: Request) {
  if (!verifyRendererApiRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized renderer' }, { status: 401 });
  }
  try {
    const body = await request.json();
    const { sessionId, snapshotRef, action, comment } = body;

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
    }

    const session = getSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    if (
      snapshotRef !== undefined
      && (
        typeof snapshotRef !== 'string'
        || !hasReviewSnapshot(sessionId, snapshotRef)
      )
    ) {
      return NextResponse.json(
        { error: 'Review snapshot is no longer available' },
        { status: 410 },
      );
    }

    // Hydrate from disk if needed
    if (!session.reviewComments && session.cwd) {
      session.reviewComments = loadFromDisk(session.cwd, sessionId);
    }
    if (action === 'clear-all') {
      session.reviewComments = (session.reviewComments || []).filter(comment =>
        typeof snapshotRef === 'string'
          ? comment.snapshotRef !== snapshotRef
          : Boolean(comment.snapshotRef));
      if (session.cwd) saveToDisk(session.cwd, sessionId, session.reviewComments);
      return NextResponse.json({ comments: [] });
    }

    // Resolve a single comment by ID
    if (action === 'resolve' && body.commentId) {
      const c = (session.reviewComments || []).find((x: ReviewComment) => x.id === body.commentId);
      if (
        c
        && (
          typeof snapshotRef === 'string'
            ? c.snapshotRef === snapshotRef
            : !c.snapshotRef
        )
      ) {
        c.resolved = true;
      }
      if (session.cwd) saveToDisk(session.cwd, sessionId, session.reviewComments || []);
      return NextResponse.json({
        comments: commentsForSnapshot(session.reviewComments || [], snapshotRef),
      });
    }

    // Resolve all unresolved comments
    if (action === 'resolve-all') {
      for (const c of (session.reviewComments || [])) {
        if (
          typeof snapshotRef === 'string'
            ? c.snapshotRef === snapshotRef
            : !c.snapshotRef
        ) {
          c.resolved = true;
        }
      }
      if (session.cwd) saveToDisk(session.cwd, sessionId, session.reviewComments || []);
      return NextResponse.json({
        comments: commentsForSnapshot(session.reviewComments || [], snapshotRef),
      });
    }

    if (!comment || !comment.filePath || !comment.lineNumber || !comment.text) {
      return NextResponse.json({ error: 'Missing comment fields' }, { status: 400 });
    }

    if (!session.reviewComments) {
      session.reviewComments = [];
    }

    const newComment: ReviewComment = {
      id: crypto.randomUUID(),
      filePath: comment.filePath,
      lineNumber: comment.lineNumber,
      text: comment.text,
      createdAt: Date.now(),
      resolved: false,
      snapshotRef: typeof snapshotRef === 'string' ? snapshotRef : undefined,
      side: comment.side === 'original' ? 'original' : comment.side === 'current' ? 'current' : undefined,
      startLine: Number.isInteger(comment.startLine) ? comment.startLine : undefined,
      endLine: Number.isInteger(comment.endLine) ? comment.endLine : undefined,
      contentHash: typeof comment.contentHash === 'string' ? comment.contentHash.slice(0, 128) : undefined,
      contextExcerpt: typeof comment.contextExcerpt === 'string'
        ? comment.contextExcerpt.slice(0, 2_000)
        : undefined,
    };

    session.reviewComments.push(newComment);
    if (session.cwd) saveToDisk(session.cwd, sessionId, session.reviewComments);

    return NextResponse.json({
      comments: commentsForSnapshot(session.reviewComments, snapshotRef),
    });
  } catch (error) {
    console.error('[sessions/comments]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

/**
 * DELETE /api/sessions/comments
 * Remove a specific comment.
 */
export async function DELETE(request: Request) {
  if (!verifyRendererApiRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized renderer' }, { status: 401 });
  }
  try {
    const body = await request.json();
    const { sessionId, snapshotRef, commentId } = body;

    if (!sessionId || !commentId) {
      return NextResponse.json({ error: 'Missing sessionId or commentId' }, { status: 400 });
    }

    const session = getSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    if (
      snapshotRef !== undefined
      && (
        typeof snapshotRef !== 'string'
        || !hasReviewSnapshot(sessionId, snapshotRef)
      )
    ) {
      return NextResponse.json(
        { error: 'Review snapshot is no longer available' },
        { status: 410 },
      );
    }

    // Hydrate from disk if needed
    if (!session.reviewComments && session.cwd) {
      session.reviewComments = loadFromDisk(session.cwd, sessionId);
    }

    session.reviewComments = (session.reviewComments || []).filter(c =>
      c.id !== commentId
      || (
        typeof snapshotRef === 'string'
          ? c.snapshotRef !== snapshotRef
          : Boolean(c.snapshotRef)
      ));
    if (session.cwd) saveToDisk(session.cwd, sessionId, session.reviewComments);

    return NextResponse.json({
      comments: commentsForSnapshot(session.reviewComments, snapshotRef),
    });
  } catch (error) {
    console.error('[sessions/comments]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
