// File-changes tracking — native, transcript-based diffs for a session.
//
// Instead of `git diff HEAD` over a hook-collected file list, this reads the
// session's own CLI transcript (Copilot events.jsonl / Claude <id>.jsonl), the
// authoritative record of the agent's edits, and reconstructs per-session diffs
// from it — git-free and correctly isolated to this session's work.
// See docs/design/native-diff-tracking.md.
import { NextResponse } from 'next/server';
import { getSession, updateSession } from '@/lib/state/sessionStore';
import { getProvider } from '@/lib/cli';
import type { CliType } from '@/lib/types';
import { getSessionFileChanges, getSessionFileDiff } from '@/lib/cli/transcript';
import { writeFileSync, unlinkSync, existsSync, readFileSync } from 'fs';

/**
 * GET /api/sessions/changes?sessionId=<id>
 *   -> { sessionId, sessionName, files: [{ path, status, additions, deletions }], totalFiles }
 *
 * GET /api/sessions/changes?sessionId=<id>&file=<path>
 *   -> { file, original, current, isNew }
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');
    const filePath = searchParams.get('file');

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
    }

    const session = getSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const cliType: CliType = session.cliType || 'claude';
    const transcriptPath = getProvider(cliType).getTranscriptPath(sessionId);

    // Single-file diff.
    if (filePath) {
      const diff = transcriptPath
        ? getSessionFileDiff(transcriptPath, cliType, filePath)
        : null;
      if (!diff) {
        // Fall back to current on-disk content with an empty baseline so the
        // viewer still renders something for files we can't reconstruct.
        const current = existsSync(filePath) ? safeRead(filePath) : '';
        return NextResponse.json({ file: filePath, original: '', current, isNew: current !== '' });
      }
      return NextResponse.json(diff);
    }

    // Full change list.
    const files = transcriptPath ? getSessionFileChanges(transcriptPath, cliType) : [];
    return NextResponse.json({
      sessionId,
      sessionName: session.name,
      files,
      totalFiles: files.length,
    });
  } catch (error: unknown) {
    console.error('[sessions/changes]', error);
    const message = error instanceof Error ? error.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/sessions/changes — revert changes to their pre-session state.
 * Body: { sessionId, action: 'revert-file', file } — revert one file
 * Body: { sessionId, action: 'revert-all' }        — revert every changed file
 * Body: { sessionId, action: 'clear-tracking' }    — clear the tracked list
 *
 * Revert is native (git-free): a modified/deleted file is rewritten with its
 * reconstructed baseline; a file the session created is removed.
 */
export async function POST(request: Request) {
  try {
    const { sessionId, action, file } = await request.json();

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
    }

    const session = getSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (action === 'clear-tracking') {
      updateSession(sessionId, { filesModified: [] });
      return NextResponse.json({ ok: true, message: 'Tracking cleared' });
    }

    const cliType: CliType = session.cliType || 'claude';
    const transcriptPath = getProvider(cliType).getTranscriptPath(sessionId);
    if (!transcriptPath) {
      return NextResponse.json({ error: 'No transcript for this session' }, { status: 404 });
    }

    if (action === 'revert-file' && file) {
      const res = revertOne(transcriptPath, cliType, file);
      return res.ok
        ? NextResponse.json({ ok: true, message: res.message })
        : NextResponse.json({ error: res.message }, { status: 500 });
    }

    if (action === 'revert-all') {
      const changes = getSessionFileChanges(transcriptPath, cliType);
      const results: string[] = [];
      for (const c of changes) {
        results.push(revertOne(transcriptPath, cliType, c.path).message);
      }
      return NextResponse.json({ ok: true, results });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function safeRead(path: string): string {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return '';
  }
}

function revertOne(transcriptPath: string, cliType: CliType, file: string): { ok: boolean; message: string } {
  const diff = getSessionFileDiff(transcriptPath, cliType, file);
  if (!diff) return { ok: false, message: `No change record for ${file}` };
  try {
    if (diff.isNew) {
      // The session created this file -> reverting removes it.
      if (existsSync(file)) unlinkSync(file);
      return { ok: true, message: `Removed ${file}` };
    }
    writeFileSync(file, diff.original);
    return { ok: true, message: `Reverted ${file}` };
  } catch (err: unknown) {
    const m = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Failed to revert ${file}: ${m}` };
  }
}
