import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
    '.json': 'json', '.md': 'markdown', '.css': 'css', '.scss': 'scss', '.less': 'less',
    '.html': 'html', '.htm': 'html', '.xml': 'xml', '.svg': 'xml',
    '.py': 'python', '.rs': 'rust', '.go': 'go', '.java': 'java',
    '.c': 'c', '.cpp': 'cpp', '.h': 'c', '.hpp': 'cpp',
    '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell',
    '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml',
    '.sql': 'sql', '.graphql': 'graphql', '.gql': 'graphql',
    '.dockerfile': 'dockerfile', '.rb': 'ruby', '.php': 'php',
    '.swift': 'swift', '.kt': 'kotlin', '.scala': 'scala',
    '.r': 'r', '.lua': 'lua', '.perl': 'perl', '.pl': 'perl',
    '.ini': 'ini', '.env': 'ini', '.conf': 'ini',
    '.vue': 'html', '.svelte': 'html',
  };
  // Also check filename-based detection
  const basename = path.basename(filePath).toLowerCase();
  if (basename === 'dockerfile') return 'dockerfile';
  if (basename === 'makefile') return 'makefile';
  if (basename === '.gitignore' || basename === '.dockerignore') return 'ignore';
  return map[ext] || 'plaintext';
}

async function listDirectory(dirPath: string, showHidden: boolean) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    if (!showHidden && entry.name.startsWith('.')) continue;
    if (entry.name === 'node_modules') continue;

    const fullPath = path.join(dirPath, entry.name);
    const isDir = entry.isDirectory();
    const isFile = entry.isFile();

    let size = 0;
    if (isFile) {
      try {
        const stat = await fs.stat(fullPath);
        size = stat.size;
      } catch {
        // skip stat errors
      }
    }

    results.push({
      name: entry.name,
      path: fullPath,
      isDir,
      isFile,
      size,
      ext: isFile ? path.extname(entry.name) : '',
    });
  }

  // Sort: dirs first, then files, alphabetical within each group
  results.sort((a, b) => {
    if (a.isDir && !b.isDir) return -1;
    if (!a.isDir && b.isDir) return 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  return results;
}

async function searchFiles(
  dirPath: string,
  query: string,
  glob: string | null,
  results: Array<{ file: string; line: number; content: string }>,
  maxResults: number,
  depth: number
) {
  if (depth > 10 || results.length >= maxResults) return;

  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (results.length >= maxResults) return;
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      await searchFiles(fullPath, query, glob, results, maxResults, depth + 1);
    } else if (entry.isFile()) {
      // Check glob filter
      if (glob) {
        const ext = path.extname(entry.name);
        const globExt = glob.startsWith('*.') ? glob.slice(1) : null;
        if (globExt && ext !== globExt) continue;
      }

      try {
        const stat = await fs.stat(fullPath);
        if (stat.size > MAX_FILE_SIZE) continue;

        const content = await fs.readFile(fullPath, 'utf-8');
        const lines = content.split('\n');
        const lowerQuery = query.toLowerCase();

        for (let i = 0; i < lines.length; i++) {
          if (results.length >= maxResults) return;
          if (lines[i].toLowerCase().includes(lowerQuery)) {
            results.push({
              file: fullPath,
              line: i + 1,
              content: lines[i].trim().slice(0, 200),
            });
          }
        }
      } catch {
        // skip binary / unreadable files
      }
    }
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action');
  const filePath = searchParams.get('path');

  try {
    if (action === 'tree') {
      if (!filePath) return NextResponse.json({ error: 'path required' }, { status: 400 });
      const showHidden = searchParams.get('showHidden') === 'true';
      const entries = await listDirectory(filePath, showHidden);
      return NextResponse.json({ entries });
    }

    if (action === 'read') {
      if (!filePath) return NextResponse.json({ error: 'path required' }, { status: 400 });
      const stat = await fs.stat(filePath);
      if (stat.size > MAX_FILE_SIZE) {
        return NextResponse.json({ error: 'File too large (>5MB)' }, { status: 400 });
      }
      const content = await fs.readFile(filePath, 'utf-8');
      const language = detectLanguage(filePath);
      return NextResponse.json({ content, path: filePath, language });
    }

    if (action === 'search') {
      const query = searchParams.get('query');
      const glob = searchParams.get('glob');
      if (!filePath || !query) {
        return NextResponse.json({ error: 'path and query required' }, { status: 400 });
      }
      const results: Array<{ file: string; line: number; content: string }> = [];
      await searchFiles(filePath, query, glob, results, 100, 0);
      return NextResponse.json({ results });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, path: filePath, content, newPath } = body;

    if (action === 'write') {
      if (!filePath || content === undefined) {
        return NextResponse.json({ error: 'path and content required' }, { status: 400 });
      }
      await fs.writeFile(filePath, content, 'utf-8');
      return NextResponse.json({ success: true });
    }

    if (action === 'create') {
      if (!filePath) return NextResponse.json({ error: 'path required' }, { status: 400 });
      await fs.writeFile(filePath, '', 'utf-8');
      return NextResponse.json({ success: true });
    }

    if (action === 'createDir') {
      if (!filePath) return NextResponse.json({ error: 'path required' }, { status: 400 });
      await fs.mkdir(filePath, { recursive: true });
      return NextResponse.json({ success: true });
    }

    if (action === 'delete') {
      if (!filePath) return NextResponse.json({ error: 'path required' }, { status: 400 });
      const stat = await fs.stat(filePath);
      if (stat.isDirectory()) {
        await fs.rm(filePath, { recursive: true });
      } else {
        await fs.unlink(filePath);
      }
      return NextResponse.json({ success: true });
    }

    if (action === 'rename') {
      if (!filePath || !newPath) {
        return NextResponse.json({ error: 'path and newPath required' }, { status: 400 });
      }
      await fs.rename(filePath, newPath);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
