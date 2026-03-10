import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const STORE_PATH = join(homedir(), '.claude', 'agentmatrix-tasks.json');

export interface Discussion {
  author: string;
  text: string;
  timestamp: number;
}

export interface AppTask {
  id: string;
  subject: string;
  description: string;
  status: 'pending' | 'assigned' | 'completed';
  source: 'app' | 'ado';
  adoId?: number;
  adoState?: string;
  type?: string;
  priority?: string;
  discussions: Discussion[];
  assignedTo?: string;
  assignedToName?: string;
  createdAt: number;
  assignedAt?: number;
}

function readStore(): AppTask[] {
  try {
    const tasks = JSON.parse(readFileSync(STORE_PATH, 'utf-8'));
    // Migration: add missing fields for old tasks
    return tasks.map((t: Record<string, unknown>) => ({
      ...t,
      source: t.source || 'app',
      discussions: t.discussions || [],
    }));
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

export function appendDiscussion(id: string, entry: Discussion): void {
  const tasks = readStore();
  const idx = tasks.findIndex(t => t.id === id);
  if (idx >= 0) {
    if (!tasks[idx].discussions) tasks[idx].discussions = [];
    tasks[idx].discussions.push(entry);
    writeStore(tasks);
  }
}

export function deleteAppTask(id: string): void {
  writeStore(readStore().filter(t => t.id !== id));
}
