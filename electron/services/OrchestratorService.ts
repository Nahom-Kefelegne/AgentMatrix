import { readFileSync, unlinkSync } from 'fs';
import type { PtyManager } from '../pty/PtyManager';
import { ORCHESTRATOR_PATH as CACHE_PATH } from '../../lib/state/paths';
import {
  logReapResult,
  reapOrphansForSessions,
} from './OrphanReaper';

export const ORCHESTRATOR_ENABLED = false;

let ptyManagerRef: PtyManager | null = null;

function readCachedId(): string | null {
  try {
    const data = JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
    return typeof data.sessionId === 'string' ? data.sessionId : null;
  } catch {
    return null;
  }
}

function clearCache(): void {
  try { unlinkSync(CACHE_PATH); } catch { /* already absent */ }
}

/**
 * The hidden orchestrator is disabled for now. Remove its cached identity and
 * stop any surviving process from an older AgentMatrix run so startup cannot
 * silently recreate or retain it.
 */
export function disableOrchestrator(ptyManager: PtyManager): void {
  ptyManagerRef = ptyManager;
  const cachedId = readCachedId();
  if (cachedId) {
    if (ptyManager.hasPty(cachedId)) {
      try { ptyManager.kill(cachedId); } catch {}
    }
    const reaped = reapOrphansForSessions([cachedId]);
    if (reaped.killed > 0) logReapResult('disabled orchestrator', reaped);
  }
  clearCache();
  console.log('[orchestrator] disabled');
}

/** Compatibility response for stale clients loaded before orchestrator removal. */
export async function queryOrchestrator(_instruction?: string): Promise<{
  success: boolean;
  content: string;
  lines: string[];
}> {
  return {
    success: false,
    content: 'AgentMatrix transcript search is temporarily disabled.',
    lines: [],
  };
}

/** No hidden orchestrator session exists while the feature is disabled. */
export function getOrchestratorId(): null {
  return null;
}

export function killOrchestrator(): void {
  const cachedId = readCachedId();
  if (cachedId && ptyManagerRef?.hasPty(cachedId)) {
    try { ptyManagerRef.kill(cachedId); } catch {}
  }
  clearCache();
}

/** Reset is intentionally a no-op and must never respawn a hidden session. */
export function resetOrchestrator(): void {
  killOrchestrator();
}
