import { NextResponse } from 'next/server';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';

interface SessionInfo {
  id: string;
  name: string;
  slug: string;
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

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const cwd = searchParams.get('cwd') || '';

    if (!cwd) {
      return NextResponse.json({ sessions: [] });
    }

    // Convert cwd to the projects directory name format
    // e.g. /Users/nkefelegne/Desktop/DEV -> -Users-nkefelegne-Desktop-DEV
    const projectDirName = cwd.replace(/\//g, '-');
    const projectsDir = join(homedir(), '.claude', 'projects');
    const projectPath = join(projectsDir, projectDirName);

    if (!existsSync(projectPath)) {
      return NextResponse.json({ sessions: [] });
    }

    const activeIds = getActiveSessionIds();
    const files = readdirSync(projectPath).filter(f => f.endsWith('.jsonl'));
    const sessions: SessionInfo[] = [];

    for (const file of files) {
      const sessionId = file.replace('.jsonl', '');
      const filePath = join(projectPath, file);

      try {
        // Read first few KB for slug and metadata
        const content = readFileSync(filePath, 'utf-8').slice(0, 5000);
        const slugMatch = content.match(/"slug"\s*:\s*"([^"]+)"/);
        const slug = slugMatch ? slugMatch[1] : '';

        // Check for rename in last chunk
        const fullContent = readFileSync(filePath, 'utf-8');
        const renameMatch = fullContent.match(/Session and agent renamed to: ([a-zA-Z0-9_-]+)/g);
        let name = slug;
        if (renameMatch && renameMatch.length > 0) {
          const last = renameMatch[renameMatch.length - 1];
          const m = last.match(/Session and agent renamed to: ([a-zA-Z0-9_-]+)/);
          if (m) name = m[1];
        }

        if (!name) name = `Session-${sessionId.slice(0, 8)}`;

        const stat = require('fs').statSync(filePath);

        sessions.push({
          id: sessionId,
          name,
          slug,
          lastModified: stat.mtimeMs,
          active: activeIds.has(sessionId),
        });
      } catch {
        // Skip unreadable files
      }
    }

    // Sort by last modified, newest first
    sessions.sort((a, b) => b.lastModified - a.lastModified);

    return NextResponse.json({ sessions });
  } catch (error) {
    console.error('[sessions/list]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
