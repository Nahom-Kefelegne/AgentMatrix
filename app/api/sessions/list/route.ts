import { NextResponse } from 'next/server';
import { readdirSync, existsSync, statSync, openSync, readSync, closeSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';
import { getCachedName } from '@/lib/state/nameCache';

interface SessionInfo {
  id: string;
  name: string;
  slug: string;
  projectDir: string;
  lastModified: number;
  active: boolean;
}

function getActiveSessionIds(): Set<string> {
  try {
    const output = execSync(
      "ps aux | grep '[c]laude.*--session-id' | grep -o '\\-\\-session-id [^ ]*' | awk '{print $2}'",
      { encoding: 'utf-8', timeout: 5000 },
    );
    return new Set(output.trim().split('\n').filter(Boolean));
  } catch {
    return new Set();
  }
}

/** Read name from first 3KB of transcript (slug) */
function readSlug(filePath: string): string {
  try {
    const fd = openSync(filePath, 'r');
    const buf = Buffer.alloc(3000);
    readSync(fd, buf, 0, 3000, 0);
    closeSync(fd);
    const match = buf.toString('utf-8').match(/"slug"\s*:\s*"([^"]+)"/);
    return match ? match[1] : '';
  } catch { return ''; }
}

/** Parse a project directory for sessions */
function parseProjectDir(
  projectPath: string,
  projectDirName: string,
  activeIds: Set<string>,
): SessionInfo[] {
  const sessions: SessionInfo[] = [];
  try {
    const files = readdirSync(projectPath).filter(f => f.endsWith('.jsonl'));
    for (const file of files) {
      const sessionId = file.replace('.jsonl', '');
      const filePath = join(projectPath, file);
      try {
        const slug = readSlug(filePath);
        // Name priority: cache > slug > short ID
        const name = getCachedName(sessionId) || slug || `Session-${sessionId.slice(0, 8)}`;
        const stat = statSync(filePath);
        sessions.push({
          id: sessionId,
          name,
          slug,
          projectDir: projectDirName,
          lastModified: stat.mtimeMs,
          active: activeIds.has(sessionId),
        });
      } catch {}
    }
  } catch {}
  return sessions;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const cwd = searchParams.get('cwd') || '';
    const global = searchParams.get('global') === 'true';

    const projectsDir = join(homedir(), '.claude', 'projects');
    const activeIds = getActiveSessionIds();

    if (global) {
      // Search ALL project directories
      const allSessions: SessionInfo[] = [];
      try {
        const dirs = readdirSync(projectsDir);
        for (const dir of dirs) {
          const dirPath = join(projectsDir, dir);
          try {
            const stat = statSync(dirPath);
            if (stat.isDirectory()) {
              allSessions.push(...parseProjectDir(dirPath, dir, activeIds));
            }
          } catch {}
        }
      } catch {}
      allSessions.sort((a, b) => b.lastModified - a.lastModified);
      return NextResponse.json({ sessions: allSessions });
    }

    // Search specific project directory
    if (!cwd) {
      return NextResponse.json({ sessions: [] });
    }

    const projectDirName = cwd.replace(/\//g, '-');
    const projectPath = join(projectsDir, projectDirName);

    if (!existsSync(projectPath)) {
      return NextResponse.json({ sessions: [] });
    }

    const sessions = parseProjectDir(projectPath, projectDirName, activeIds);
    sessions.sort((a, b) => b.lastModified - a.lastModified);

    return NextResponse.json({ sessions });
  } catch (error) {
    console.error('[sessions/list]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
