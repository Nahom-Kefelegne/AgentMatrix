import { NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

function getMemoryDir(cwd: string): string {
  const projectDirName = cwd.replace(/\//g, '-');
  return join(homedir(), '.claude', 'projects', projectDirName, 'memory');
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const cwd = searchParams.get('cwd') || '';
    if (!cwd) return NextResponse.json({ notes: [] });

    const memDir = getMemoryDir(cwd);
    if (!existsSync(memDir)) return NextResponse.json({ notes: [] });

    const files = readdirSync(memDir).filter(f => f.endsWith('.md'));
    const notes = files.map(f => ({
      filename: f,
      content: readFileSync(join(memDir, f), 'utf-8'),
    }));

    return NextResponse.json({ notes, path: memDir });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to read memory' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { cwd, filename, content } = await request.json();
    if (!cwd || !filename || content === undefined) {
      return NextResponse.json({ error: 'Missing cwd, filename, or content' }, { status: 400 });
    }

    const memDir = getMemoryDir(cwd);
    if (!existsSync(memDir)) mkdirSync(memDir, { recursive: true });

    writeFileSync(join(memDir, filename), content);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to write memory' }, { status: 500 });
  }
}
