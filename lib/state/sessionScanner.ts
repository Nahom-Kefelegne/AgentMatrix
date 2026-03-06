import { execSync } from 'child_process';
import { readFileSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { SessionData } from '../types';
import { SOCKET_EVENTS } from '../types';
import {
  DESK_POSITIONS,
  OVERFLOW_POSITIONS,
  ENTRANCE_POINT,
  CHARACTER_COLORS,
} from '../constants';
import { addSession, removeSession, getSession, getAllSessions, getNextDeskIndex } from './sessionStore';
import { resolveSessionName } from './sessionName';

const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects');
const SCAN_INTERVAL_MS = 10_000; // 10 seconds

interface ActiveProcess {
  sessionId: string;
  resumeName?: string;
  cwd?: string;
}

/** Parse running Claude processes to get active session IDs and resume names */
function getActiveProcesses(): ActiveProcess[] {
  try {
    const output = execSync(
      "ps aux | grep '[c]laude.*--session-id' | grep -v grep",
      { encoding: 'utf-8', timeout: 5000 },
    );

    const processes: ActiveProcess[] = [];
    for (const line of output.split('\n')) {
      const sessionMatch = line.match(/--session-id\s+([a-f0-9-]+)/);
      if (sessionMatch) {
        const resumeMatch = line.match(/--resume\s+(\S+)/);
        processes.push({
          sessionId: sessionMatch[1],
          resumeName: resumeMatch ? resumeMatch[1] : undefined,
        });
      }
    }
    return processes;
  } catch {
    return [];
  }
}

/** Find the transcript file for a session ID */
function findTranscriptPath(sessionId: string): string | undefined {
  try {
    const output = execSync(
      `find "${CLAUDE_PROJECTS_DIR}" -name "${sessionId}.jsonl" -type f 2>/dev/null`,
      { encoding: 'utf-8', timeout: 5000 },
    ).trim();
    return output.split('\n')[0] || undefined;
  } catch {
    return undefined;
  }
}

/** Extract cwd and other metadata from transcript first line */
function parseTranscriptMeta(transcriptPath: string): { cwd?: string; slug?: string } {
  try {
    const content = readFileSync(transcriptPath, 'utf-8');
    const firstLine = content.split('\n')[0];
    const data = JSON.parse(firstLine);
    return { cwd: data.cwd, slug: data.slug };
  } catch {
    return {};
  }
}

/** Create a SessionData from a discovered active process */
function createSessionFromProcess(proc: ActiveProcess): SessionData | null {
  const transcriptPath = findTranscriptPath(proc.sessionId);
  const meta = transcriptPath ? parseTranscriptMeta(transcriptPath) : {};

  // Priority: --resume name > transcript slug/rename > cwd > session ID
  const name = proc.resumeName
    || resolveSessionName(transcriptPath, meta.cwd, proc.sessionId);

  const deskIndex = getNextDeskIndex();
  const isDesk = deskIndex < DESK_POSITIONS.length;
  const isOverflow = !isDesk && deskIndex < DESK_POSITIONS.length + OVERFLOW_POSITIONS.length;
  const deskPosition = isDesk
    ? DESK_POSITIONS[deskIndex]
    : isOverflow
      ? OVERFLOW_POSITIONS[deskIndex - DESK_POSITIONS.length]
      : ENTRANCE_POINT;

  const colorIndex = getAllSessions().length % CHARACTER_COLORS.length;

  return {
    id: proc.sessionId,
    name,
    color: CHARACTER_COLORS[colorIndex],
    status: 'idle',
    deskIndex,
    deskPosition,
    spawnPosition: ENTRANCE_POINT,
    recentActions: [],
    agents: [],
    cwd: meta.cwd,
    createdAt: Date.now(),
  };
}

/** Scan for active sessions and sync with store. Returns new/removed session IDs. */
export function scanActiveSessions(): {
  added: SessionData[];
  removed: string[];
} {
  const activeProcesses = getActiveProcesses();
  const activeIds = new Set(activeProcesses.map(p => p.sessionId));
  const currentSessions = getAllSessions();
  const currentIds = new Set(currentSessions.map(s => s.id));

  const added: SessionData[] = [];
  const removed: string[] = [];

  // Add new sessions
  for (const proc of activeProcesses) {
    if (!currentIds.has(proc.sessionId)) {
      const session = createSessionFromProcess(proc);
      if (session) {
        addSession(session);
        added.push(session);
      }
    }
  }

  // Remove sessions that are no longer running
  for (const session of currentSessions) {
    if (!activeIds.has(session.id)) {
      removeSession(session.id);
      removed.push(session.id);
    }
  }

  return { added, removed };
}

let scanTimer: ReturnType<typeof setInterval> | null = null;

/** Start periodic scanning. Calls onChange with added/removed sessions. */
export function startSessionScanner(
  onChange: (added: SessionData[], removed: string[]) => void,
): void {
  // Initial scan
  const initial = scanActiveSessions();
  if (initial.added.length > 0 || initial.removed.length > 0) {
    onChange(initial.added, initial.removed);
  }

  // Periodic scan
  scanTimer = setInterval(() => {
    const result = scanActiveSessions();
    if (result.added.length > 0 || result.removed.length > 0) {
      onChange(result.added, result.removed);
    }
  }, SCAN_INTERVAL_MS);
}

export function stopSessionScanner(): void {
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
  }
}
