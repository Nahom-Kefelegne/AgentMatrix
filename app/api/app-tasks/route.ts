import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { getAllAppTasks, addAppTask, updateAppTask, deleteAppTask } from '@/lib/state/appTaskStore';

/** Read Claude's tasks for a session from ~/.claude/tasks/<sessionId>/ */
function getClaudeTasks(sessionId: string): { subject: string; status: string }[] {
  const dir = join(homedir(), '.claude', 'tasks', sessionId);
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          const data = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
          return { subject: String(data.subject || '').trim(), status: String(data.status || '') };
        } catch { return null; }
      })
      .filter(Boolean) as { subject: string; status: string }[];
  } catch { return []; }
}

/** Sync assigned app tasks with Claude's actual task status */
function syncFromClaude(): void {
  const appTasks = getAllAppTasks();
  for (const task of appTasks) {
    if (task.status !== 'assigned' || !task.assignedTo) continue;

    const claudeTasks = getClaudeTasks(task.assignedTo);
    const match = claudeTasks.find(ct =>
      ct.subject.toLowerCase() === task.subject.toLowerCase()
    );

    if (match) {
      if (match.status === 'completed') {
        updateAppTask(task.id, { status: 'completed' });
      } else if (match.status === 'deleted') {
        updateAppTask(task.id, { status: 'pending', assignedTo: null, assignedToName: null, assignedAt: null });
      }
      // in_progress/pending stay as 'assigned' in our store
    }
  }
}

export async function GET() {
  // Sync from Claude's task files before returning
  syncFromClaude();
  return NextResponse.json({ tasks: getAllAppTasks() });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'create') {
      const task = {
        id: randomUUID(),
        subject: body.subject || '',
        description: body.description || '',
        status: 'pending' as const,
        createdAt: Date.now(),
      };
      addAppTask(task);
      return NextResponse.json({ task });
    }

    if (action === 'update') {
      updateAppTask(body.id, body.changes);
      return NextResponse.json({ ok: true });
    }

    if (action === 'delete') {
      deleteAppTask(body.id);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('[app-tasks]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
