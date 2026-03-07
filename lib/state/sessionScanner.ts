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
import { addSession, removeSession, getSession, updateSession, getAllSessions, getNextDeskIndex } from './sessionStore';
import { resolveSessionName, checkForRename } from './sessionName';
import { getCachedName, setCachedName } from './nameCache';

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
    // Only read first 3KB instead of entire file (can be 10MB+)
    const fd = require('fs').openSync(transcriptPath, 'r');
    const buf = Buffer.alloc(3000);
    require('fs').readSync(fd, buf, 0, 3000, 0);
    require('fs').closeSync(fd);
    const firstLine = buf.toString('utf-8').split('\n')[0];
    const data = JSON.parse(firstLine);
    let cwd = data.cwd;

    // If no cwd in transcript, derive from project directory name
    // e.g. /.../.claude/projects/-Users-nkefelegne-Desktop-DEV-teams-modular-packages/xxx.jsonl
    // → /Users/nkefelegne/Desktop/DEV/teams-modular-packages
    if (!cwd) {
      const parts = transcriptPath.split('/');
      const projectsIdx = parts.indexOf('projects');
      if (projectsIdx >= 0 && projectsIdx + 1 < parts.length) {
        const dirName = parts[projectsIdx + 1]; // e.g. -Users-nkefelegne-Desktop-DEV
        cwd = dirName.replace(/^-/, '/').replace(/-/g, '/');
      }
    }

    return { cwd, slug: data.slug };
  } catch {
    return {};
  }
}

/** Create a SessionData from a discovered active process */
function createSessionFromProcess(proc: ActiveProcess): SessionData | null {
  const transcriptPath = findTranscriptPath(proc.sessionId);
  const meta = transcriptPath ? parseTranscriptMeta(transcriptPath) : {};

  // Priority: --resume name > cached name > transcript rename/slug > cwd > session ID
  const name = proc.resumeName
    || getCachedName(proc.sessionId)
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

/** Scan for active sessions and sync with store. Returns new/removed/updated sessions. */
export function scanActiveSessions(): {
  added: SessionData[];
  removed: string[];
  updated: { sessionId: string; name: string }[];
} {
  const activeProcesses = getActiveProcesses();
  const activeIds = new Set(activeProcesses.map(p => p.sessionId));
  const currentSessions = getAllSessions();
  const currentIds = new Set(currentSessions.map(s => s.id));

  const added: SessionData[] = [];
  const removed: string[] = [];
  const updated: { sessionId: string; name: string }[] = [];

  // Add new sessions or update names for existing ones
  for (const proc of activeProcesses) {
    if (!currentIds.has(proc.sessionId)) {
      const session = createSessionFromProcess(proc);
      if (session) {
        addSession(session);
        setCachedName(session.id, session.name);
        added.push(session);
      }
    } else {
      const existing = getSession(proc.sessionId);
      if (!existing) continue;

      // Update resume name if available
      if (proc.resumeName && existing.name !== proc.resumeName) {
        updateSession(proc.sessionId, { name: proc.resumeName });
        setCachedName(proc.sessionId, proc.resumeName);
        updated.push({ sessionId: proc.sessionId, name: proc.resumeName });
      }

      // Fill in missing cwd
      if (!existing.cwd) {
        const transcriptPath = findTranscriptPath(proc.sessionId);
        if (transcriptPath) {
          const meta = parseTranscriptMeta(transcriptPath);
          if (meta.cwd) {
            updateSession(proc.sessionId, { cwd: meta.cwd });
          }
        }
      }
    }
  }

  // Re-check names for all existing sessions — only picks up /rename from CLI.
  // We intentionally do NOT re-resolve with resolveSessionName() here, because
  // slug/cwd fallbacks can overwrite a good name with a worse one (e.g. a slug
  // found in conversation content of a forked/compacted session).
  for (const proc of activeProcesses) {
    if (currentIds.has(proc.sessionId) && !proc.resumeName) {
      const existing = getSession(proc.sessionId);
      if (!existing) continue;
      const transcriptPath = findTranscriptPath(proc.sessionId);
      if (transcriptPath) {
        const renamed = checkForRename(transcriptPath);
        if (renamed && renamed !== existing.name) {
          updateSession(proc.sessionId, { name: renamed });
          setCachedName(proc.sessionId, renamed);
          updated.push({ sessionId: proc.sessionId, name: renamed });
        }
      }
    }
  }

  // Remove sessions that are no longer running
  // Skip app-managed sessions (temp IDs starting with "new-") — they're not in ps aux
  for (const session of currentSessions) {
    if (session.id.startsWith('new-')) continue;
    if (!activeIds.has(session.id)) {
      removeSession(session.id);
      removed.push(session.id);
    }
  }

  return { added, removed, updated };
}

let scanTimer: ReturnType<typeof setInterval> | null = null;

/** Start periodic scanning. Calls onChange with added/removed/updated sessions. */
export function startSessionScanner(
  onChange: (added: SessionData[], removed: string[], updated: { sessionId: string; name: string }[]) => void,
): void {
  // Initial scan
  const initial = scanActiveSessions();
  if (initial.added.length > 0 || initial.removed.length > 0 || initial.updated.length > 0) {
    onChange(initial.added, initial.removed, initial.updated);
  }

  // Periodic scan
  scanTimer = setInterval(() => {
    const result = scanActiveSessions();
    if (result.added.length > 0 || result.removed.length > 0 || result.updated.length > 0) {
      onChange(result.added, result.removed, result.updated);
    }
  }, SCAN_INTERVAL_MS);
}

export function stopSessionScanner(): void {
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
  }
}
