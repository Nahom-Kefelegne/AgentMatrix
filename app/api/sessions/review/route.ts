// Writes review markdown for Claude to read and act on
import { NextResponse } from 'next/server';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import type { ReviewComment } from '@/lib/types';

const REVIEW_DIR = join(homedir(), '.claude');

function getReviewFilePath(sessionId: string): string {
  return join(REVIEW_DIR, `agentmatrix-review-${sessionId}.md`);
}

/**
 * POST /api/sessions/review
 * Write review comments to a markdown file for Claude to read.
 * Body: { sessionId, comments: ReviewComment[] }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { sessionId, comments } = body as { sessionId: string; comments: ReviewComment[] };

    if (!sessionId || !comments || comments.length === 0) {
      return NextResponse.json({ error: 'Missing sessionId or comments' }, { status: 400 });
    }

    const filePath = getReviewFilePath(sessionId);

    // Group comments by file
    const grouped = new Map<string, ReviewComment[]>();
    for (const c of comments) {
      const existing = grouped.get(c.filePath) || [];
      existing.push(c);
      grouped.set(c.filePath, existing);
    }

    const sections: string[] = [
      '# Code Review Comments',
      '',
      'Please address each comment below by making the requested changes.',
      '',
    ];

    for (const [file, fileComments] of grouped) {
      // Use shorter display path
      const displayPath = file.includes('/') ? file.split('/').slice(-3).join('/') : basename(file);
      sections.push(`## ${displayPath}`);
      sections.push(`<!-- Full path: ${file} -->`);
      sections.push('');

      // Sort by line number
      fileComments.sort((a, b) => a.lineNumber - b.lineNumber);

      for (const c of fileComments) {
        sections.push(`### Line ${c.lineNumber}`);
        sections.push(c.text);
        sections.push('');
      }
    }

    writeFileSync(filePath, sections.join('\n'), 'utf-8');

    return NextResponse.json({ ok: true, filePath });
  } catch (error) {
    console.error('[sessions/review]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

/**
 * DELETE /api/sessions/review
 * Clean up review file.
 * Body: { sessionId }
 */
export async function DELETE(request: Request) {
  try {
    const body = await request.json();
    const filePath = getReviewFilePath(body.sessionId);
    if (existsSync(filePath)) unlinkSync(filePath);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Cleanup failed' }, { status: 500 });
  }
}
