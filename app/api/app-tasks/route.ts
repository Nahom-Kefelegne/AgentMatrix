import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getAllAppTasks, addAppTask, updateAppTask, deleteAppTask, appendDiscussion } from '@/lib/state/appTaskStore';

export async function GET() {
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
        source: (body.source || 'app') as 'app' | 'ado',
        adoId: body.adoId,
        adoState: body.adoState,
        type: body.type,
        priority: body.priority,
        discussions: body.discussions || [],
        createdAt: Date.now(),
      };
      addAppTask(task);
      return NextResponse.json({ task });
    }

    if (action === 'discuss') {
      appendDiscussion(body.id, {
        author: body.author || 'User',
        text: body.text,
        timestamp: Date.now(),
      });
      return NextResponse.json({ ok: true });
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
