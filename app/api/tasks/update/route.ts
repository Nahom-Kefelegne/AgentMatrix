import { NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export async function POST(request: Request) {
  try {
    const { listId, taskId, changes } = await request.json();

    if (!listId || !taskId || !changes) {
      return NextResponse.json({ error: 'Missing listId, taskId, or changes' }, { status: 400 });
    }

    const filePath = join(homedir(), '.claude', 'tasks', listId, `${taskId}.json`);
    if (!existsSync(filePath)) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const existing = JSON.parse(readFileSync(filePath, 'utf-8'));
    const updated = { ...existing, ...changes };
    writeFileSync(filePath, JSON.stringify(updated, null, 2));

    return NextResponse.json({ ok: true, task: updated });
  } catch (error) {
    console.error('[tasks/update]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
