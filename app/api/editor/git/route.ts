import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

async function gitExec(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  return stdout;
}

function parseStatus(output: string): Array<{ path: string; status: string; staged: boolean }> {
  const files: Array<{ path: string; status: string; staged: boolean }> = [];
  const lines = output.split('\n').filter(l => l.length > 0);

  for (const line of lines) {
    const indexStatus = line[0];
    const workTreeStatus = line[1];
    const filePath = line.slice(3).trim();

    // If index has a status, it's staged
    if (indexStatus !== ' ' && indexStatus !== '?') {
      files.push({ path: filePath, status: indexStatus, staged: true });
    }
    // If worktree has a status, it's unstaged
    if (workTreeStatus !== ' ' && workTreeStatus !== undefined) {
      const status = workTreeStatus === '?' ? '?' : workTreeStatus;
      // Don't double-add untracked files
      if (indexStatus === '?' && workTreeStatus === '?') {
        files.push({ path: filePath, status: '?', staged: false });
      } else if (workTreeStatus !== '?') {
        files.push({ path: filePath, status, staged: false });
      }
    }
  }

  return files;
}

function parseLog(output: string): Array<{ hash: string; message: string; author: string; date: string }> {
  const commits: Array<{ hash: string; message: string; author: string; date: string }> = [];
  const lines = output.split('\n').filter(l => l.length > 0);

  for (const line of lines) {
    // Format: hash|author|date|message
    const parts = line.split('|');
    if (parts.length >= 4) {
      commits.push({
        hash: parts[0],
        author: parts[1],
        date: parts[2],
        message: parts.slice(3).join('|'),
      });
    }
  }

  return commits;
}

function parseBlame(output: string): Array<{ hash: string; author: string; line: number; content: string }> {
  const lines: Array<{ hash: string; author: string; line: number; content: string }> = [];
  const rawLines = output.split('\n');

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    // Porcelain blame format: each entry starts with hash
    const match = line.match(/^(\w+)\s+.*?\((.+?)\s+\d{4}-\d{2}-\d{2}.*?\s+(\d+)\)\s?(.*)/);
    if (match) {
      lines.push({
        hash: match[1].slice(0, 8),
        author: match[2].trim(),
        line: parseInt(match[3], 10),
        content: match[4],
      });
    }
  }

  return lines;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action');
  const cwd = searchParams.get('cwd');

  if (!cwd) {
    return NextResponse.json({ error: 'cwd required' }, { status: 400 });
  }

  try {
    if (action === 'status') {
      const output = await gitExec(['status', '--porcelain'], cwd);
      const files = parseStatus(output);
      return NextResponse.json({ files });
    }

    if (action === 'diff') {
      const file = searchParams.get('file');
      const args = ['diff'];
      if (file) args.push('--', file);
      const diff = await gitExec(args, cwd);

      // Also get staged diff
      const stagedArgs = ['diff', '--cached'];
      if (file) stagedArgs.push('--', file);
      let stagedDiff = '';
      try {
        stagedDiff = await gitExec(stagedArgs, cwd);
      } catch {
        // no staged changes
      }

      return NextResponse.json({ diff, stagedDiff });
    }

    if (action === 'log') {
      const limit = searchParams.get('limit') || '50';
      const output = await gitExec(
        ['log', `--max-count=${limit}`, '--format=%h|%an|%ad|%s', '--date=short'],
        cwd
      );
      const commits = parseLog(output);
      return NextResponse.json({ commits });
    }

    if (action === 'branches') {
      const output = await gitExec(['branch', '--no-color'], cwd);
      const lines = output.split('\n').filter(l => l.trim().length > 0);
      let current = '';
      const branches: string[] = [];

      for (const line of lines) {
        const name = line.replace(/^\*?\s+/, '').trim();
        if (line.startsWith('*')) {
          current = name;
        }
        branches.push(name);
      }

      return NextResponse.json({ current, branches });
    }

    if (action === 'blame') {
      const file = searchParams.get('file');
      if (!file) return NextResponse.json({ error: 'file required' }, { status: 400 });
      const output = await gitExec(['blame', file], cwd);
      const lines = parseBlame(output);
      return NextResponse.json({ lines });
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
    const { action, cwd, files, message, branch } = body;

    if (!cwd) {
      return NextResponse.json({ error: 'cwd required' }, { status: 400 });
    }

    if (action === 'stage') {
      if (!files || !Array.isArray(files)) {
        return NextResponse.json({ error: 'files array required' }, { status: 400 });
      }
      await gitExec(['add', ...files], cwd);
      return NextResponse.json({ success: true });
    }

    if (action === 'unstage') {
      if (!files || !Array.isArray(files)) {
        return NextResponse.json({ error: 'files array required' }, { status: 400 });
      }
      await gitExec(['restore', '--staged', ...files], cwd);
      return NextResponse.json({ success: true });
    }

    if (action === 'commit') {
      if (!message) {
        return NextResponse.json({ error: 'message required' }, { status: 400 });
      }
      const output = await gitExec(['commit', '-m', message], cwd);
      return NextResponse.json({ success: true, output });
    }

    if (action === 'checkout') {
      if (!branch) {
        return NextResponse.json({ error: 'branch required' }, { status: 400 });
      }
      await gitExec(['checkout', branch], cwd);
      return NextResponse.json({ success: true });
    }

    if (action === 'discard') {
      if (!files || !Array.isArray(files)) {
        return NextResponse.json({ error: 'files array required' }, { status: 400 });
      }
      await gitExec(['checkout', '--', ...files], cwd);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
