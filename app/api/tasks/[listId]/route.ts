import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { TaskItem } from '@/lib/types';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ listId: string }> },
) {
  try {
    const { listId } = await params;
    const listPath = path.join(os.homedir(), '.claude', 'tasks', listId);

    if (!fs.existsSync(listPath)) {
      return NextResponse.json({ error: 'Task list not found' }, { status: 404 });
    }

    const files = fs.readdirSync(listPath).filter((f) => f.endsWith('.json'));
    const tasks: TaskItem[] = [];

    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(listPath, file), 'utf-8');
        const data = JSON.parse(raw);
        tasks.push({
          id: data.id ?? path.basename(file, '.json'),
          subject: data.subject ?? '',
          description: data.description ?? '',
          status: data.status ?? 'pending',
          owner: data.owner,
          activeForm: data.activeForm,
          blocks: data.blocks ?? [],
          blockedBy: data.blockedBy ?? [],
        });
      } catch {
        // Skip malformed task files
      }
    }

    return NextResponse.json({ tasks });
  } catch (error) {
    console.error('[tasks/listId]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
