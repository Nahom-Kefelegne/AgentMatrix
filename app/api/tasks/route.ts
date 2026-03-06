import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { TaskItem, TaskList } from '@/lib/types';
import { resolveSessionName } from '@/lib/state/sessionName';

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Try to find a friendly name for a task list directory */
function resolveListName(dirName: string): string {
  // If it's not a UUID, it's already a readable name (like a team name)
  if (!UUID_REGEX.test(dirName)) return dirName;

  // Try to find a transcript for this session ID
  const projectsDir = path.join(CLAUDE_DIR, 'projects');
  try {
    const projects = fs.readdirSync(projectsDir);
    for (const proj of projects) {
      const transcriptPath = path.join(projectsDir, proj, `${dirName}.jsonl`);
      if (fs.existsSync(transcriptPath)) {
        return resolveSessionName(transcriptPath, undefined, dirName);
      }
    }
  } catch {
    // ignore
  }

  return `Tasks-${dirName.slice(0, 8)}`;
}

export async function GET() {
  try {
    const tasksDir = path.join(CLAUDE_DIR, 'tasks');

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

      if (tasks.length === 0) continue; // Skip empty lists

      taskLists.push({
        id: entry.name,
        name: resolveListName(entry.name),
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
