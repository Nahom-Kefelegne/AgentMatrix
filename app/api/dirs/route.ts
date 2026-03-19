import { NextResponse } from 'next/server';
import { readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';

/**
 * Get available drive letters on Windows.
 */
function getWindowsDrives(): { name: string; path: string }[] {
  try {
    // wmic is available on all Windows versions
    const output = execSync('wmic logicaldisk get name', { encoding: 'utf-8' });
    return output.split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => /^[A-Z]:$/.test(line))
      .map(drive => ({ name: `${drive}\\`, path: `${drive}\\` }));
  } catch {
    // Fallback: probe common drive letters
    const drives: { name: string; path: string }[] = [];
    for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      const path = `${letter}:\\`;
      if (existsSync(path)) {
        drives.push({ name: path, path });
      }
    }
    return drives;
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const parentPath = searchParams.get('path') || homedir();

    // Windows: if requesting drives list
    if (searchParams.get('drives') === 'true' && process.platform === 'win32') {
      return NextResponse.json({ parent: '', dirs: getWindowsDrives(), drives: true });
    }

    const entries = readdirSync(parentPath, { withFileTypes: true });
    const dirs = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => ({
        name: e.name,
        path: join(parentPath, e.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ parent: parentPath, dirs });
  } catch (error) {
    return NextResponse.json({ parent: '', dirs: [], error: 'Cannot read directory' }, { status: 400 });
  }
}
