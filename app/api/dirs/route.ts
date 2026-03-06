import { NextResponse } from 'next/server';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const parentPath = searchParams.get('path') || homedir();

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
