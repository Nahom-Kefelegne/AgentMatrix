import { NextResponse } from 'next/server';
import { readdirSync, existsSync, statSync, openSync, readSync, closeSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { getCachedName } from '@/lib/state/nameCache';

/** Read cwd from transcript first line */
function readTranscriptCwd(filePath: string): string | null {
  try {
    const fd = openSync(filePath, 'r');
    const buf = Buffer.alloc(4000);
    readSync(fd, buf, 0, 4000, 0);
    closeSync(fd);
    const firstLine = buf.toString('utf-8').split('\n')[0];
    const parsed = JSON.parse(firstLine);
    return parsed.cwd && existsSync(parsed.cwd) ? parsed.cwd : null;
  } catch { return null; }
}

/**
 * Decode a Claude project dir name back to a real filesystem path.
 * Claude encodes '/' as '-', but folder names can also contain '-'.
 * Greedily matches existing directories from left to right.
 */
function decodeDirName(encoded: string): string | null {
  const segments = encoded.split('-');
  let path = '';
  let i = 0;
  while (i < segments.length) {
    let found = false;
    for (let end = segments.length; end > i; end--) {
      const candidate = path + '/' + segments.slice(i, end).join('-');
      if (existsSync(candidate)) {
        path = candidate;
        i = end;
        found = true;
        break;
      }
    }
    if (!found) {
      path += '/' + segments[i];
      i++;
    }
  }
  return existsSync(path) ? path : null;
}

/**
 * Resolve a session ID to its project CWD by scanning ~/.claude/projects/
 * GET /api/sessions/resolve?id=<sessionId>
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('id');
    if (!sessionId) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }

    const projectsDir = join(homedir(), '.claude', 'projects');
    if (!existsSync(projectsDir)) {
      return NextResponse.json({ error: 'No projects directory' }, { status: 404 });
    }

    const dirs = readdirSync(projectsDir);
    for (const dir of dirs) {
      const dirPath = join(projectsDir, dir);
      try {
        if (!statSync(dirPath).isDirectory()) continue;
        const transcriptPath = join(dirPath, `${sessionId}.jsonl`);
        if (existsSync(transcriptPath)) {
          // Try reading cwd from transcript first line
          const transcriptCwd = readTranscriptCwd(transcriptPath);
          // Fall back to decoding project dir name (handles hyphens in folder names)
          const encoded = dir.replace(/^-/, '');
          const dirCwd = transcriptCwd || decodeDirName(encoded);
          const name = getCachedName(sessionId) || `Session-${sessionId.slice(0, 8)}`;
          if (dirCwd) {
            return NextResponse.json({ id: sessionId, cwd: dirCwd, name, projectDir: dir });
          }
        }
      } catch { /* skip */ }
    }

    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  } catch (error) {
    console.error('[sessions/resolve]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
