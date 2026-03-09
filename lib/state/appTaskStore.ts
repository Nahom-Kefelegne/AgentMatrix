import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const STORE_PATH = join(homedir(), '.claude', 'agentmatrix-tasks.json');

export interface AppTask {
  id: string;
  subject: string;
  description: string;
  status: 'pending' | 'assigned' | 'completed';
  assignedTo?: string; // session ID
  assignedToName?: string; // session name
  createdAt: number;
  assignedAt?: number;
}

function readStore(): AppTask[] {
  try {
    return JSON.parse(readFileSync(STORE_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

function writeStore(tasks: AppTask[]): void {
  try {
    writeFileSync(STORE_PATH, JSON.stringify(tasks, null, 2));
  } catch {}
}

export function getAllAppTasks(): AppTask[] {
  return readStore();
}

export function addAppTask(task: AppTask): void {
  const tasks = readStore();
  tasks.push(task);
  writeStore(tasks);
}

export function updateAppTask(id: string, changes: Record<string, unknown>): void {
  const tasks = readStore();
  const idx = tasks.findIndex(t => t.id === id);
  if (idx >= 0) {
    for (const [key, val] of Object.entries(changes)) {
      if (val === null || val === undefined) {
        delete (tasks[idx] as Record<string, unknown>)[key];
      } else {
        (tasks[idx] as Record<string, unknown>)[key] = val;
      }
    }
    writeStore(tasks);
  }
}

export function deleteAppTask(id: string): void {
  writeStore(readStore().filter(t => t.id !== id));
}
