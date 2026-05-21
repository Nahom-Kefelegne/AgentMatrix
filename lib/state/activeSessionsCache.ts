import { readFileSync, writeFileSync } from 'fs';
import { ACTIVE_SESSIONS_PATH as CACHE_PATH, ensureDir, AGENTMATRIX_DIR } from './paths';

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
    ensureDir(AGENTMATRIX_DIR);
    writeFileSync(CACHE_PATH, JSON.stringify(sessions, null, 2));
  } catch {}
}
