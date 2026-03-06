import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { TaskItem, TaskList } from '@/lib/types';

export async function GET() {
  try {
    const tasksDir = path.join(os.homedir(), '.claude', 'tasks');

    if (!fs.existsSync(tasksDir)) {
      return NextResponse.json({ taskLists: [] });
    }

    const entries = fs.readdirSync(tasksDir, { withFileTypes: true });
    const taskLists: TaskList[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const listPath = path.join(tasksDir, entry.name);
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

      taskLists.push({
        id: entry.name,
        path: listPath,
        tasks,
      });
    }

    return NextResponse.json({ taskLists });
  } catch (error) {
    console.error('[tasks]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
