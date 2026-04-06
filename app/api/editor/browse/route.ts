import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { readFile, stat } from 'fs/promises';
import { extname, basename } from 'path';

const MAX_FILE_SIZE = 5 * 1024 * 1024;

function execAsync(cmd: string, cwd: string, timeout = 10000): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd, maxBuffer: 10 * 1024 * 1024, timeout }, (err, stdout) => {
      if (err && !stdout) reject(err);
      else resolve(stdout);
    });
  });
}

function detectLanguage(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
    '.json': 'json', '.md': 'markdown', '.css': 'css', '.scss': 'scss', '.less': 'less',
    '.html': 'html', '.htm': 'html', '.xml': 'xml', '.svg': 'xml',
    '.py': 'python', '.rs': 'rust', '.go': 'go', '.java': 'java',
    '.c': 'c', '.cpp': 'cpp', '.h': 'c', '.hpp': 'cpp',
    '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell',
    '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml',
    '.sql': 'sql', '.graphql': 'graphql', '.gql': 'graphql',
    '.rb': 'ruby', '.php': 'php', '.swift': 'swift', '.kt': 'kotlin',
  };
  const base = basename(filePath).toLowerCase();
  if (base === 'dockerfile') return 'dockerfile';
  if (base === 'makefile') return 'makefile';
  return map[ext] || 'plaintext';
}

/**
 * GET /api/editor/browse
 *
 * ?action=repo-root&path=<cwd>
 *   → { root, isRepo } — finds git root or returns cwd
 *
 * ?action=files&root=<path>
 *   → { files: string[] } — all tracked files via git ls-files
 *
 * ?action=search&root=<path>&query=<q>&type=filename|content
 *   → { results: [...] } — fast search via git grep / filename filter
 *
 * ?action=read&path=<filepath>
 *   → { content, language, path }
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  try {
    if (action === 'repo-root') {
      const cwd = searchParams.get('path');
      if (!cwd) return NextResponse.json({ error: 'path required' }, { status: 400 });
      try {
        const root = (await execAsync('git rev-parse --show-toplevel', cwd)).trim();
        return NextResponse.json({ root, isRepo: true });
      } catch {
        return NextResponse.json({ root: cwd, isRepo: false });
      }
    }

    if (action === 'files') {
      const root = searchParams.get('root');
      if (!root) return NextResponse.json({ error: 'root required' }, { status: 400 });

      let files: string[];
      try {
        // git ls-files is fastest — uses index, respects .gitignore
        const output = await execAsync('git ls-files --cached --others --exclude-standard', root);
        files = output.split('\n').filter(Boolean);
      } catch {
        // Fallback: find (exclude common junk)
        const output = await execAsync(
          'find . -type f -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*" -not -path "*/.next/*" | head -5000',
          root
        );
        files = output.split('\n').filter(Boolean).map(f => f.replace(/^\.\//, ''));
      }

      return NextResponse.json({ files });
    }

    if (action === 'search') {
      const root = searchParams.get('root');
      const query = searchParams.get('query');
      const type = searchParams.get('type') || 'filename';
      if (!root || !query) return NextResponse.json({ error: 'root and query required' }, { status: 400 });

      if (type === 'filename') {
        // Already have the file list client-side — but if called, filter here
        try {
          const output = await execAsync('git ls-files --cached --others --exclude-standard', root);
          const files = output.split('\n').filter(Boolean);
          const lower = query.toLowerCase();
          const matched = files.filter(f => f.toLowerCase().includes(lower)).slice(0, 100);
          return NextResponse.json({ results: matched.map(f => ({ file: f })) });
        } catch {
          return NextResponse.json({ results: [] });
        }
      }

      if (type === 'content') {
        try {
          // git grep is fast and uses the index
          const escaped = query.replace(/[\\'"]/g, '\\$&');
          const output = await execAsync(
            `git grep -n -I --max-count=3 -i "${escaped}" -- ':(exclude)*.lock' ':(exclude)*.min.*' | head -200`,
            root,
            15000
          );
          const results = output.split('\n').filter(Boolean).map(line => {
            const firstColon = line.indexOf(':');
            const secondColon = line.indexOf(':', firstColon + 1);
            if (firstColon === -1 || secondColon === -1) return null;
            return {
              file: line.slice(0, firstColon),
              line: parseInt(line.slice(firstColon + 1, secondColon), 10),
              content: line.slice(secondColon + 1).trim().slice(0, 200),
            };
          }).filter(Boolean);
          return NextResponse.json({ results });
        } catch {
          // git grep returns exit code 1 when no matches
          return NextResponse.json({ results: [] });
        }
      }

      return NextResponse.json({ error: 'type must be filename or content' }, { status: 400 });
    }

    if (action === 'read') {
      const filePath = searchParams.get('path');
      if (!filePath) return NextResponse.json({ error: 'path required' }, { status: 400 });
      const st = await stat(filePath);
      if (st.size > MAX_FILE_SIZE) {
        return NextResponse.json({ error: 'File too large (>5MB)' }, { status: 400 });
      }
      const content = await readFile(filePath, 'utf-8');
      const language = detectLanguage(filePath);
      return NextResponse.json({ content, path: filePath, language });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
