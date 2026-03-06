import { NextResponse } from 'next/server';
import { writeFileSync, readdirSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export async function POST(request: Request) {
  try {
    const { listId, subject, description } = await request.json();

    if (!listId || !subject) {
      return NextResponse.json({ error: 'Missing listId or subject' }, { status: 400 });
    }

    const listDir = join(homedir(), '.claude', 'tasks', listId);
    if (!existsSync(listDir)) {
      mkdirSync(listDir, { recursive: true });
    }

    // Find next task ID
    const existing = readdirSync(listDir).filter(f => f.endsWith('.json'));
    const ids = existing.map(f => parseInt(f.replace('.json', ''), 10)).filter(n => !isNaN(n));
    const nextId = ids.length > 0 ? Math.max(...ids) + 1 : 1;

    const task = {
      id: String(nextId),
      subject,
      description: description || subject,
      status: 'pending',
      blocks: [],
      blockedBy: [],
    };

    writeFileSync(join(listDir, `${nextId}.json`), JSON.stringify(task, null, 2));

    return NextResponse.json({ ok: true, task });
  } catch (error) {
    console.error('[tasks/create]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
