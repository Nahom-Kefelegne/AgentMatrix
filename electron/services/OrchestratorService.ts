import { PtyManager, type PtySession } from '../pty/PtyManager';
import { type InjectOptions } from '../pty/PromptInjector';
import { captureQuery } from '../../lib/cli/acp/captureQuery';
import { OutputParser } from '../pty/OutputParser';
import { readFileSync, writeFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { ORCHESTRATOR_PATH as CACHE_PATH, ensureDir, AGENTMATRIX_DIR } from '../../lib/state/paths';
import { getSettings } from '../../lib/state/appSettings';
import {
  resolveOrchestratorProvider,
  type OrchestratorProvider,
} from '../../lib/state/orchestratorProvider';
import { getProvider } from '../../lib/cli';
import type { CliType } from '../../lib/cli/CliProvider';

const SYSTEM_PROMPT = 'You are AgentMatrix Orchestrator. Execute tasks immediately. Write output to the file path specified in the prompt using Bash. Output only what is asked. No preamble. No questions. Do not modify any file except the specified output file.';

/** Provider used when nothing resolves, preserving the pre-existing behavior. */
const FALLBACK_PROVIDER: CliType = 'copilot';

/** Cached orchestrator identity. `cliType` was added so a provider change
 *  invalidates the cache instead of resuming under the wrong CLI. */
interface OrchestratorCache {
  sessionId: string;
  cliType?: CliType;
}

function readCache(): OrchestratorCache | null {
  try {
    const data = JSON.parse(readFileSync(CACHE_PATH, 'utf-8'));
    return data.sessionId ? { sessionId: data.sessionId, cliType: data.cliType } : null;
  } catch { return null; }
}

function writeCache(sessionId: string, cliType: CliType): void {
  try {
    ensureDir(AGENTMATRIX_DIR);
    writeFileSync(CACHE_PATH, JSON.stringify({ sessionId, cliType }));
  } catch {}
}

/**
 * Whether a provider can actually be spawned. Every OrchestratorProvider is now
 * registered in `getProvider` (kimi included), so availability is decided purely
 * by whether the binary is on disk. Any future unregistered provider still
 * reports false rather than throwing, via the catch below.
 */
function isProviderAvailable(provider: OrchestratorProvider): boolean {
  try {
    getProvider(provider).findBinary();
    return true;
  } catch {
    return false;
  }
}

/** Resolve the configured orchestrator provider, falling back audibly. */
function resolveProvider(): CliType {
  const setting = getSettings().orchestratorProvider;
  const resolved = resolveOrchestratorProvider(setting, isProviderAvailable);
  if (!resolved) {
    console.warn(
      `[orchestrator] no provider available for setting '${setting ?? 'auto'}', ` +
      `falling back to '${FALLBACK_PROVIDER}'`,
    );
    return FALLBACK_PROVIDER;
  }
  // Narrowing: isProviderAvailable only returns true for registered CliTypes.
  return resolved as CliType;
}

let orchestratorId: string | null = null;
let orchestratorSession: PtySession | null = null;
let ptyManagerRef: PtyManager | null = null;
let isSpawning = false;

/** Spawn fresh orchestrator under `cliType` */
function spawnFresh(ptyManager: PtyManager, cliType: CliType): boolean {
  const id = randomUUID();
  try {
    const cwd = process.cwd();
    ptyManager.spawnNew(id, {
      cwd,
      sessionUuid: id,
      name: 'agentMatrixOrchestrator(doNotUseManually)',
      permissionMode: 'bypassPermissions',
      systemPrompt: SYSTEM_PROMPT,
      cliType,
    });
    orchestratorId = id;
    orchestratorSession = ptyManager.getSession(id) || null;
    writeCache(id, cliType);
    // Name the session so it's identifiable
    const { setCachedName } = require('../../lib/state/nameCache');
    setCachedName(id, 'agentMatrixOrchestrator(doNotUseManually)');
    console.log(`[orchestrator] spawned new id=${id.slice(0, 12)}`);
    return true;
  } catch (err) {
    console.error('[orchestrator] spawn failed:', err);
    return false;
  }
}

/**
 * Monitor orchestrator PTY output on startup.
 * Watches for trust prompt and auto-accepts it.
 */
function startupMonitor(session: PtySession): void {
  let buffer = '';
  let done = false;

  // Trust-prompt phrasing is provider-owned; the session carries its own
  // cliType, so this works unchanged for any provider. Fall back to a small
  // default set if the provider exposes none (or isn't registered).
  let trustPatterns: string[] = [];
  try {
    trustPatterns = getProvider(session.cliType || FALLBACK_PROVIDER).getTrustPromptPatterns();
  } catch { /* use fallback */ }
  const fallback = ['trust this folder', 'trust this project', 'Is this a project', 'Yes, I trust', 'Do you trust'];
  const patterns = trustPatterns.length > 0 ? [...trustPatterns, ...fallback] : fallback;

  const monitor = (data: string) => {
    if (done) return;

    buffer += data;
    const clean = OutputParser.stripAnsi(buffer);

    // Check for trust prompt keywords
    if (patterns.some(p => clean.includes(p))) {
      console.log('[orchestrator] detected trust prompt, auto-accepting...');
      // Send Enter to accept pre-selected "Yes, I trust"
      setTimeout(() => session.pty.write('\r'), 300);
      // Stop monitoring after acceptance
      setTimeout(() => { done = true; session.subscribers.delete(monitor); }, 2000);
      return;
    }

    // Keep buffer manageable
    if (buffer.length > 10000) buffer = buffer.slice(-5000);
  };

  session.subscribers.add(monitor);

  // Stop monitoring after 60s — trust prompt shows in first few seconds if at all
  setTimeout(() => {
    if (!done) {
      done = true;
      session.subscribers.delete(monitor);
      console.log('[orchestrator] startup monitor done, no trust prompt detected');
    }
  }, 60000);
}

/** Spawn or resume the orchestrator session */
export function spawnOrchestrator(ptyManager: PtyManager): void {
  if (orchestratorSession || isSpawning) return;
  isSpawning = true;
  ptyManagerRef = ptyManager;

  try {
    const cliType = resolveProvider();
    const cached = readCache();

    // Only resume a cached orchestrator that belongs to the provider we're
    // about to run as, and that still exists on disk. A cache written under a
    // different CLI points at a session the current provider can't resume (it
    // would just exit), so spawn fresh rather than leave a dead PTY to be
    // reaped later. This generalises the old Claude→Copilot migration case.
    const providerChanged = !!cached?.cliType && cached.cliType !== cliType;
    const cachedCwd = cached && !providerChanged
      ? ptyManager.findSessionCwd(cached.sessionId, cliType)
      : undefined;

    if (cached && cachedCwd) {
      try {
        ptyManager.spawnResume(cached.sessionId, {
          cwd: cachedCwd, resumeId: cached.sessionId, cliType,
        });
        orchestratorId = cached.sessionId;
        orchestratorSession = ptyManager.getSession(cached.sessionId) || null;
        console.log(`[orchestrator] resumed id=${cached.sessionId.slice(0, 12)} cli=${cliType}`);
      } catch {
        console.log(`[orchestrator] resume failed, spawning fresh`);
        spawnFresh(ptyManager, cliType);
      }
    } else {
      if (cached && providerChanged) {
        console.log(
          `[orchestrator] cached session is ${cached.cliType}, resolved provider is ${cliType} — spawning fresh`,
        );
      } else if (cached) {
        console.log(`[orchestrator] cached id is not a ${cliType} session, spawning fresh`);
      }
      spawnFresh(ptyManager, cliType);
    }

    // Name and monitor on every startup
    if (orchestratorSession && orchestratorId) {
      const { setCachedName } = require('../../lib/state/nameCache');
      setCachedName(orchestratorId, 'agentMatrixOrchestrator(doNotUseManually)');
      startupMonitor(orchestratorSession);
    }
  } catch (err) {
    console.error('[orchestrator] failed:', err);
    orchestratorSession = null;
  } finally {
    isSpawning = false;
  }
}

/** Check if orchestrator is alive, respawn if needed */
function ensureAlive(): PtySession | null {
  if (orchestratorSession && orchestratorSession.status !== 'closed') {
    return orchestratorSession;
  }

  orchestratorSession = null;
  if (ptyManagerRef) {
    if (orchestratorId) {
      try { ptyManagerRef.kill(orchestratorId); } catch {}
    }
    spawnOrchestrator(ptyManagerRef);
  }

  return orchestratorSession;
}

/** Send a query to the orchestrator and get structured output */
export async function queryOrchestrator(
  instruction: string,
  opts?: InjectOptions,
): Promise<{ success: boolean; content: string; lines: string[] }> {
  const session = ensureAlive();
  if (!session || !ptyManagerRef) {
    return { success: false, content: '', lines: [] };
  }

  return captureQuery(ptyManagerRef, session, instruction, opts ?? {});
}

/** Get the orchestrator session ID (for excluding from UI) */
export function getOrchestratorId(): string | null {
  return orchestratorId;
}

/** Check if a session ID is the orchestrator */
export function isOrchestrator(sessionId: string): boolean {
  return !!orchestratorId && sessionId === orchestratorId;
}

/** Kill the orchestrator */
export function killOrchestrator(): void {
  if (ptyManagerRef && orchestratorId) {
    try { ptyManagerRef.kill(orchestratorId); } catch {}
  }
  orchestratorSession = null;
}

/** Reset orchestrator — kill current, clear cache, spawn fresh */
export function resetOrchestrator(): void {
  killOrchestrator();
  orchestratorId = null;
  try { require('fs').unlinkSync(CACHE_PATH); } catch {}
  if (ptyManagerRef) {
    spawnOrchestrator(ptyManagerRef);
  }
}
