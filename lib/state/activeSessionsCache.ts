import { readFileSync, writeFileSync } from 'fs';
import { ACTIVE_SESSIONS_PATH as CACHE_PATH, ensureDir, AGENTMATRIX_DIR } from './paths';

export interface CachedSession {
  id: string;
  name: string;
  cwd: string;
  cliType?: 'claude' | 'copilot';
  permissionMode?: string;
  model?: string;
  effort?: string;
  allowedTools?: string;
  copilotMode?: string;
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

export function setActiveSessionName(sessionId: string, name: string): void {
  const sessions = getActiveSessions();
  const index = sessions.findIndex(session => session.id === sessionId);
  if (index < 0 || sessions[index].name === name) return;
  sessions[index] = { ...sessions[index], name };
  saveActiveSessions(sessions);
}

export function getActiveSession(sessionId: string): CachedSession | undefined {
  return getActiveSessions().find(session => session.id === sessionId);
}
