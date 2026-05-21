import { NextResponse } from 'next/server';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import type { Discussion } from '@/lib/state/appTaskStore';
import { taskFilePath, TASK_FILES_DIR, ensureDir } from '@/lib/state/paths';

function getTaskFilePath(sessionId: string, taskId: string): string {
  ensureDir(TASK_FILES_DIR);
  return taskFilePath(sessionId, taskId);
}

/**
 * Write task details to a file for Claude to read.
 * POST body: { sessionId, taskId, subject, description, type, priority, discussions }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { sessionId, taskId, subject, description, type, priority, discussions } = body;

    if (!sessionId || !taskId || !subject) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const filePath = getTaskFilePath(sessionId, taskId);

    // Build task document
    const sections: string[] = [
      `# Task Assignment`,
      ``,
      `## Subject`,
      subject,
      ``,
    ];

    if (type) {
      sections.push(`## Type`, type, ``);
    }

    if (priority) {
      sections.push(`## Priority`, `P${priority}`, ``);
    }

    if (description) {
      sections.push(`## Description`, description, ``);
    }

    if (discussions && discussions.length > 0) {
      sections.push(`## Discussion / Comments`);
      for (const d of discussions as Discussion[]) {
        const date = new Date(d.timestamp).toLocaleString();
        // Truncate long comments
        const text = d.text.length > 300 ? d.text.slice(0, 300) + '...' : d.text;
        sections.push(``, `**${d.author}** (${date}):`, text);
      }
      sections.push(``);
    }

    writeFileSync(filePath, sections.join('\n'), 'utf-8');

    return NextResponse.json({ ok: true, filePath });
  } catch (error) {
    console.error('[task-assign]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

/**
 * Clean up task file after Claude has read it.
 * DELETE body: { sessionId, taskId }
 */
export async function DELETE(request: Request) {
  try {
    const body = await request.json();
    const filePath = getTaskFilePath(body.sessionId, body.taskId);
    if (existsSync(filePath)) unlinkSync(filePath);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Cleanup failed' }, { status: 500 });
  }
}
