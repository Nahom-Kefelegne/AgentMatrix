// Writes review markdown for Claude to read and act on
import { NextResponse } from 'next/server';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import type { ReviewComment } from '@/lib/types';
import { reviewFilePath, REVIEW_DIR, ensureDir } from '@/lib/state/paths';
import { baseName, parentPath } from '@/lib/paths/displayPath';
import { verifyRendererApiRequest } from '@/lib/navigation/rendererAuth';

function getReviewFilePath(sessionId: string): string {
  ensureDir(REVIEW_DIR);
  return reviewFilePath(sessionId);
}

/**
 * POST /api/sessions/review
 * Write review comments to a markdown file for Claude to read.
 * Body: { sessionId, comments: ReviewComment[] }
 */
export async function POST(request: Request) {
  if (!verifyRendererApiRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized renderer' }, { status: 401 });
  }
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
      const parent = parentPath(file).split('/').filter(Boolean).slice(-2);
      const displayPath = [...parent, baseName(file)].join('/');
      sections.push(`## ${displayPath}`);
      sections.push(`<!-- Full path: ${file} -->`);
      sections.push('');

      // Sort by line number
      fileComments.sort((a, b) => {
        const sideOrder = (a.side === 'original' ? 0 : 1)
          - (b.side === 'original' ? 0 : 1);
        return sideOrder || a.lineNumber - b.lineNumber;
      });

      for (const c of fileComments) {
        const startLine = c.startLine ?? c.lineNumber;
        const endLine = c.endLine ?? startLine;
        const sideLabel = c.side === 'original'
          ? ' — removed/base side'
          : c.side === 'current'
            ? ' — current side'
            : '';
        sections.push(
          `### ${startLine === endLine ? `Line ${startLine}` : `Lines ${startLine}-${endLine}`}${sideLabel}`,
        );
        if (c.snapshotRef) {
          sections.push(`Snapshot: \`${c.snapshotRef}\``);
          if (c.contentHash) sections.push(`Content hash: \`${c.contentHash}\``);
          sections.push('');
        }
        sections.push(c.text);
        if (c.contextExcerpt) {
          sections.push('');
          sections.push('Frozen review context:');
          sections.push('```text');
          sections.push(c.contextExcerpt.replace(/```/g, '``\u200b`'));
          sections.push('```');
        }
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
  if (!verifyRendererApiRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized renderer' }, { status: 401 });
  }
  try {
    const body = await request.json();
    const filePath = getReviewFilePath(body.sessionId);
    if (existsSync(filePath)) unlinkSync(filePath);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Cleanup failed' }, { status: 500 });
  }
}
