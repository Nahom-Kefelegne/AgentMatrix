import { NextResponse } from 'next/server';
import { getSession } from '@/lib/state/sessionStore';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import type { ReviewComment } from '@/lib/types';

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
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('sessionId');

  if (!sessionId) {
    return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
  }

  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  // Hydrate from disk if not loaded yet
  if (!session.reviewComments && session.cwd) {
    session.reviewComments = loadFromDisk(session.cwd, sessionId);
  }

  return NextResponse.json({ comments: session.reviewComments || [] });
}

/**
 * POST /api/sessions/comments
 * Add a comment or clear all comments.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { sessionId, action, comment } = body;

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
    }

    const session = getSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // Hydrate from disk if needed
    if (!session.reviewComments && session.cwd) {
      session.reviewComments = loadFromDisk(session.cwd, sessionId);
    }

    if (action === 'clear-all') {
      session.reviewComments = [];
      if (session.cwd) saveToDisk(session.cwd, sessionId, []);
      return NextResponse.json({ comments: [] });
    }

    // Resolve a single comment by ID
    if (action === 'resolve' && body.commentId) {
      const c = (session.reviewComments || []).find((x: ReviewComment) => x.id === body.commentId);
      if (c) c.resolved = true;
      if (session.cwd) saveToDisk(session.cwd, sessionId, session.reviewComments || []);
      return NextResponse.json({ comments: session.reviewComments || [] });
    }

    // Resolve all unresolved comments
    if (action === 'resolve-all') {
      for (const c of (session.reviewComments || [])) c.resolved = true;
      if (session.cwd) saveToDisk(session.cwd, sessionId, session.reviewComments || []);
      return NextResponse.json({ comments: session.reviewComments || [] });
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
    };

    session.reviewComments.push(newComment);
    if (session.cwd) saveToDisk(session.cwd, sessionId, session.reviewComments);

    return NextResponse.json({ comments: session.reviewComments });
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
  try {
    const body = await request.json();
    const { sessionId, commentId } = body;

    if (!sessionId || !commentId) {
      return NextResponse.json({ error: 'Missing sessionId or commentId' }, { status: 400 });
    }

    const session = getSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // Hydrate from disk if needed
    if (!session.reviewComments && session.cwd) {
      session.reviewComments = loadFromDisk(session.cwd, sessionId);
    }

    session.reviewComments = (session.reviewComments || []).filter(c => c.id !== commentId);
    if (session.cwd) saveToDisk(session.cwd, sessionId, session.reviewComments);

    return NextResponse.json({ comments: session.reviewComments });
  } catch (error) {
    console.error('[sessions/comments]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
