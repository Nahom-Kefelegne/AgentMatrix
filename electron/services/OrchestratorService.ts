import { PtyManager, type PtySession } from '../pty/PtyManager';
import { injectPrompt, type InjectOptions } from '../pty/PromptInjector';
import { OutputParser } from '../pty/OutputParser';
import { homedir } from 'os';
import { join } from 'path';
import { readFileSync, writeFileSync } from 'fs';
import { randomUUID } from 'crypto';

const CACHE_PATH = join(homedir(), '.claude', 'agentmatrix-orchestrator.json');

const SYSTEM_PROMPT = 'You are AgentMatrix Orchestrator. Execute tasks immediately. Write output to the file path specified in the prompt using Bash. Output only what is asked. No preamble. No questions. Do not modify any file except the specified output file.';

function readCachedId(): string | null {
  try {
    const data = JSON.parse(readFileSync(CACHE_PATH, 'utf-8'));
    return data.sessionId || null;
  } catch { return null; }
}

function writeCachedId(sessionId: string): void {
  try { writeFileSync(CACHE_PATH, JSON.stringify({ sessionId })); } catch {}
}

let orchestratorId: string | null = null;
let orchestratorSession: PtySession | null = null;
let ptyManagerRef: PtyManager | null = null;
let isSpawning = false;

/** Spawn fresh orchestrator */
function spawnFresh(ptyManager: PtyManager): boolean {
  const id = randomUUID();
  try {
    const cwd = process.cwd();
    ptyManager.spawnNew(id, {
      cwd,
      sessionUuid: id,
      permissionMode: 'bypassPermissions',
      systemPrompt: SYSTEM_PROMPT,
    });
    orchestratorId = id;
    orchestratorSession = ptyManager.getSession(id) || null;
    writeCachedId(id);
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
  let accepted = false;
  const prevOnData = session.onData;

  const monitor = (data: string) => {
    // Always forward
    if (prevOnData) prevOnData(data);
    if (accepted) return;

    buffer += data;
    const clean = OutputParser.stripAnsi(buffer);

    // Check for trust prompt keywords
    if (clean.includes('trust this folder') || clean.includes('trust this project') ||
        clean.includes('Is this a project') || clean.includes('Yes, I trust')) {
      accepted = true;
      console.log('[orchestrator] detected trust prompt, auto-accepting...');
      // Send Enter to accept pre-selected "Yes, I trust"
      setTimeout(() => session.pty.write('\r'), 300);
      // Restore original handler after acceptance
      setTimeout(() => {
        if (session.onData === monitor) session.onData = prevOnData;
      }, 2000);
      return;
    }

    // Keep buffer manageable
    if (buffer.length > 10000) buffer = buffer.slice(-5000);
  };

  session.onData = monitor;

  // Stop monitoring after 60s — trust prompt shows in first few seconds if at all
  setTimeout(() => {
    if (!accepted && session.onData === monitor) {
      session.onData = prevOnData;
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
    const cachedId = readCachedId();

    if (cachedId) {
      try {
        const cwd = ptyManager.findSessionCwd(cachedId) || process.cwd();
        ptyManager.spawnResume(cachedId, { cwd, resumeId: cachedId });
        orchestratorId = cachedId;
        orchestratorSession = ptyManager.getSession(cachedId) || null;
        console.log(`[orchestrator] resumed id=${cachedId.slice(0, 12)}`);
      } catch {
        console.log(`[orchestrator] resume failed, spawning fresh`);
        spawnFresh(ptyManager);
      }
    } else {
      spawnFresh(ptyManager);
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
  if (!session) {
    return { success: false, content: '', lines: [] };
  }

  return injectPrompt(session, instruction, opts);
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
