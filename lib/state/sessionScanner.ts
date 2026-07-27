import type { SessionData, CliType } from '../types';
import {
  DESK_POSITIONS,
  OVERFLOW_POSITIONS,
  ENTRANCE_POINT,
  CHARACTER_COLORS,
} from '../constants';
import {
  addSession,
  removeSession,
  getSession,
  updateSession,
  getAllSessions,
  getNextDeskIndex,
  isAppManaged,
} from './sessionStore';
import { resolveSessionName, checkForRename, isGeneratedSessionName } from './sessionName';
import { getCachedName, setCachedName } from './nameCache';
import { setActiveSessionName } from './activeSessionsCache';
import { allProviders } from '../cli';
import type { CliProvider, ActiveProcessInfo, DiscoveredSession } from '../cli/CliProvider';

const SCAN_INTERVAL_MS = 10_000;

interface ActiveProcess extends ActiveProcessInfo {
  cliType: CliType;
}

function findDiscoveredSession(provider: CliProvider, sessionId: string): DiscoveredSession | undefined {
  try {
    let latest: DiscoveredSession | undefined;
    for (const session of provider.discoverSessions()) {
      if (session.id !== sessionId) continue;
      if (!latest || (session.lastModified ?? 0) > (latest.lastModified ?? 0)) latest = session;
    }
    return latest;
  } catch {
    return undefined;
  }
}

/**
 * Collect active processes across all known CLIs. Each provider owns
 * its own detection strategy (Claude reads --session-id from ps; Copilot
 * cross-references inuse.<PID>.lock files against live copilot PIDs).
 *
 * COST: one ps/wmic subprocess per provider — ~10-50ms total. Called
 * every 10s by the scanner; never on render paths.
 */
function collectActiveProcesses(): ActiveProcess[] {
  const out: ActiveProcess[] = [];
  for (const provider of allProviders()) {
    let entries: ActiveProcessInfo[] = [];
    try {
      entries = provider.detectActiveSessionIds();
    } catch {
      // Provider's detection is best-effort; never let one CLI take
      // down the scanner.
      continue;
    }
    for (const e of entries) {
      out.push({ ...e, cliType: provider.type });
    }
  }
  return out;
}

function createSessionFromProcess(
  proc: ActiveProcess,
  provider: CliProvider,
): SessionData {
  const discovered = findDiscoveredSession(provider, proc.sessionId);
  const cwd = discovered?.cwd || provider.findSessionCwd(proc.sessionId);

  // Priority: --resume name > provider metadata > cached name > transcript/cwd
  // fallback > session ID.
  const name = proc.resumeName
    || discovered?.name
    || getCachedName(proc.sessionId)
    || resolveSessionName(discovered?.transcriptPath, cwd, proc.sessionId);

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
    cwd,
    cliType: proc.cliType,
    createdAt: Date.now(),
  };
}

export function scanActiveSessions(): {
  added: SessionData[];
  removed: string[];
  updated: { sessionId: string; name: string }[];
} {
  const activeProcesses = collectActiveProcesses();
  const activeIds = new Set(activeProcesses.map(p => p.sessionId));
  const currentSessions = getAllSessions();
  const currentIds = new Set(currentSessions.map(s => s.id));

  const added: SessionData[] = [];
  const removed: string[] = [];
  const updated: { sessionId: string; name: string }[] = [];

  const providerByType = new Map<CliType, CliProvider>();
  for (const p of allProviders()) providerByType.set(p.type, p);

  for (const proc of activeProcesses) {
    const provider = providerByType.get(proc.cliType);
    if (!provider) continue;

    if (!currentIds.has(proc.sessionId)) {
      const session = createSessionFromProcess(proc, provider);
      addSession(session);
      setCachedName(session.id, session.name);
      added.push(session);
      continue;
    }

    const existing = getSession(proc.sessionId);
    if (!existing) continue;

    if (proc.resumeName && existing.name !== proc.resumeName) {
      updateSession(proc.sessionId, { name: proc.resumeName });
      setCachedName(proc.sessionId, proc.resumeName);
      setActiveSessionName(proc.sessionId, proc.resumeName);
      updated.push({ sessionId: proc.sessionId, name: proc.resumeName });
    } else if (proc.cliType === 'copilot' && isGeneratedSessionName(existing.name, proc.sessionId)) {
      // Copilot's process list carries only the UUID on resume, while its real
      // display name lives in workspace.yaml. Upgrade synthetic scanner names
      // once metadata becomes available so already-running moved sessions heal.
      const discovered = findDiscoveredSession(provider, proc.sessionId);
      if (discovered?.name && discovered.name !== existing.name) {
        updateSession(proc.sessionId, { name: discovered.name });
        setCachedName(proc.sessionId, discovered.name);
        setActiveSessionName(proc.sessionId, discovered.name);
        updated.push({ sessionId: proc.sessionId, name: discovered.name });
      }
    }

    if (!existing.cwd) {
      const cwd = provider.findSessionCwd(proc.sessionId);
      if (cwd) updateSession(proc.sessionId, { cwd });
    }
  }

  // Re-check names for /rename detected via Claude transcript scan.
  // Copilot doesn't have an equivalent in-transcript rename signal yet;
  // its workspace.yaml `name` field is captured at discovery time and
  // not mutated mid-session.
  //
  // Build the transcript-path lookup once per tick. discoverSessions()
  // does directory walks + partial reads — calling it inside the loop
  // would re-scan disk N times.
  const claudeProvider = providerByType.get('claude');
  const transcriptPathById = new Map<string, string>();
  if (claudeProvider) {
    try {
      for (const s of claudeProvider.discoverSessions()) {
        if (s.transcriptPath) transcriptPathById.set(s.id, s.transcriptPath);
      }
    } catch { /* leave map empty */ }
  }
  for (const proc of activeProcesses) {
    if (!currentIds.has(proc.sessionId) || proc.resumeName) continue;
    if (proc.cliType !== 'claude') continue;
    const existing = getSession(proc.sessionId);
    if (!existing) continue;

    const transcriptPath = transcriptPathById.get(proc.sessionId);
    if (!transcriptPath) continue;
    const renamed = checkForRename(transcriptPath);
    if (renamed && renamed !== existing.name) {
      updateSession(proc.sessionId, { name: renamed });
      setCachedName(proc.sessionId, renamed);
      setActiveSessionName(proc.sessionId, renamed);
      updated.push({ sessionId: proc.sessionId, name: renamed });
    }
  }

  for (const session of currentSessions) {
    if (isAppManaged(session.id)) continue;
    if (!activeIds.has(session.id)) {
      removeSession(session.id);
      removed.push(session.id);
    }
  }

  return { added, removed, updated };
}

let scanTimer: ReturnType<typeof setInterval> | null = null;

export function startSessionScanner(
  onChange: (added: SessionData[], removed: string[], updated: { sessionId: string; name: string }[]) => void,
): void {
  const initial = scanActiveSessions();
  if (initial.added.length > 0 || initial.removed.length > 0 || initial.updated.length > 0) {
    onChange(initial.added, initial.removed, initial.updated);
  }

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
