import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

interface FileResult {
  name: string;
  path: string;
  dir: string;
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', '.cache', 'dist', 'build',
  '.turbo', '.vercel', '__pycache__', '.venv', 'venv',
  'target', '.idea', '.vscode', 'coverage',
]);

async function findFiles(
  dirPath: string,
  rootPath: string,
  query: string,
  results: FileResult[],
  maxResults: number,
  depth: number,
) {
  if (depth > 8 || results.length >= maxResults) return;

  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch { return; }

  const lowerQuery = query.toLowerCase();

  for (const entry of entries) {
    if (results.length >= maxResults) return;
    if (entry.name.startsWith('.') && depth > 0) continue;
    if (SKIP_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dirPath, entry.name);

    if (entry.isFile()) {
      // Fuzzy match: check if all query chars appear in order
      if (fuzzyMatch(entry.name.toLowerCase(), lowerQuery)) {
        const relDir = path.relative(rootPath, dirPath);
        results.push({
          name: entry.name,
          path: fullPath,
          dir: relDir || '.',
        });
      }
    } else if (entry.isDirectory()) {
      await findFiles(fullPath, rootPath, query, results, maxResults, depth + 1);
    }
  }
}

function fuzzyMatch(text: string, query: string): boolean {
  let qi = 0;
  for (let i = 0; i < text.length && qi < query.length; i++) {
    if (text[i] === query[qi]) qi++;
  }
  return qi === query.length;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const root = searchParams.get('root');
  const q = searchParams.get('q');

  if (!root || !q) {
    return NextResponse.json({ error: 'root and q required' }, { status: 400 });
  }

  try {
    const results: FileResult[] = [];
    await findFiles(root, root, q, results, 30, 0);

    // Sort: exact prefix matches first, then by name length
    const lower = q.toLowerCase();
    results.sort((a, b) => {
      const aStarts = a.name.toLowerCase().startsWith(lower) ? 0 : 1;
      const bStarts = b.name.toLowerCase().startsWith(lower) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
      return a.name.length - b.name.length;
    });

    return NextResponse.json({ files: results });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
