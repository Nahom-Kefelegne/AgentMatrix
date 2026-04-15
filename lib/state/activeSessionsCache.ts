import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CACHE_PATH = join(homedir(), '.claude', 'agentmatrix-active-sessions.json');

export interface CachedSession {
  id: string;
  name: string;
  cwd: string;
  cliType?: 'claude' | 'copilot';
}

export function getActiveSessions(): CachedSession[] {
  try {
    return JSON.parse(readFileSync(CACHE_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

export function saveActiveSessions(sessions: CachedSession[]): void {
  try {
    writeFileSync(CACHE_PATH, JSON.stringify(sessions, null, 2));
  } catch {}
}
