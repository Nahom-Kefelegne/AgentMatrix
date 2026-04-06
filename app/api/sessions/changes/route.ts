// File changes tracking — git diff integration for session file modifications
import { NextResponse } from 'next/server';
import { getSession, updateSession } from '@/lib/state/sessionStore';
import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { dirname } from 'path';

/**
 * GET /api/sessions/changes?sessionId=<id>
 * Returns list of files modified by the session with their diffs.
 *
 * GET /api/sessions/changes?sessionId=<id>&file=<path>
 * Returns diff for a specific file (original vs current).
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

    const files = session.filesModified || [];

    // Single file diff
    if (filePath) {
      if (!existsSync(filePath)) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
      }

      const current = readFileSync(filePath, 'utf-8');
      let original = '';

      // Get the git HEAD version of the file
      try {
        const dir = dirname(filePath);
        // Find repo root
        const repoRoot = execSync('git rev-parse --show-toplevel', { cwd: dir, encoding: 'utf-8' }).trim();
        const relativePath = filePath.replace(repoRoot + '/', '').replace(repoRoot + '\\', '');
        original = execSync(`git show HEAD:${relativePath}`, { cwd: repoRoot, encoding: 'utf-8' });
      } catch {
        // File might be new (not in git) — original is empty
        original = '';
      }

      return NextResponse.json({
        file: filePath,
        original,
        current,
        isNew: original === '',
      });
    }

    // List all modified files with summary
    const fileChanges = files.map(f => {
      const exists = existsSync(f);
      let status = 'modified';
      let additions = 0;
      let deletions = 0;

      if (exists) {
        try {
          const dir = dirname(f);
          const repoRoot = execSync('git rev-parse --show-toplevel', { cwd: dir, encoding: 'utf-8' }).trim();
          const relativePath = f.replace(repoRoot + '/', '').replace(repoRoot + '\\', '');
          const diff = execSync(`git diff HEAD -- "${relativePath}"`, { cwd: repoRoot, encoding: 'utf-8' });
          if (!diff) {
            // No diff means file matches HEAD — might have been reverted
            status = 'unchanged';
          } else {
            additions = (diff.match(/^\+[^+]/gm) || []).length;
            deletions = (diff.match(/^-[^-]/gm) || []).length;
          }
          // Check if file is new (not tracked)
          try {
            execSync(`git show HEAD:${relativePath}`, { cwd: repoRoot, stdio: 'pipe' });
          } catch {
            status = 'new';
          }
        } catch {
          status = 'untracked';
        }
      } else {
        status = 'deleted';
      }

      return { path: f, status, additions, deletions };
    }).filter(f => f.status !== 'unchanged');

    return NextResponse.json({
      sessionId,
      sessionName: session.name,
      files: fileChanges,
      totalFiles: fileChanges.length,
    });
  } catch (error: any) {
    console.error('[sessions/changes]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/sessions/changes — Revert changes
 * Body: { sessionId, action: 'revert-file', file } — revert single file to HEAD
 * Body: { sessionId, action: 'revert-all' } — revert all tracked files
 * Body: { sessionId, action: 'clear-tracking' } — just clear the tracking list
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

    if (action === 'revert-file' && file) {
      try {
        const dir = dirname(file);
        const repoRoot = execSync('git rev-parse --show-toplevel', { cwd: dir, encoding: 'utf-8' }).trim();
        const relativePath = file.replace(repoRoot + '/', '').replace(repoRoot + '\\', '');
        execSync(`git checkout HEAD -- "${relativePath}"`, { cwd: repoRoot });
        // Remove from tracking
        const updated = (session.filesModified || []).filter((f: string) => f !== file);
        updateSession(sessionId, { filesModified: updated });
        return NextResponse.json({ ok: true, message: `Reverted ${relativePath}` });
      } catch (err: any) {
        return NextResponse.json({ error: `Revert failed: ${err.message}` }, { status: 500 });
      }
    }

    if (action === 'revert-all') {
      const files = session.filesModified || [];
      const results: string[] = [];
      for (const f of files) {
        try {
          const dir = dirname(f);
          const repoRoot = execSync('git rev-parse --show-toplevel', { cwd: dir, encoding: 'utf-8' }).trim();
          const relativePath = f.replace(repoRoot + '/', '').replace(repoRoot + '\\', '');
          execSync(`git checkout HEAD -- "${relativePath}"`, { cwd: repoRoot });
          results.push(`Reverted ${relativePath}`);
        } catch {
          results.push(`Failed to revert ${f}`);
        }
      }
      updateSession(sessionId, { filesModified: [] });
      return NextResponse.json({ ok: true, results });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
