import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';

/**
 * Central registry of Agent Matrix's on-disk state paths.
 *
 * Historically these lived under `~/.claude/agentmatrix-*.json` which
 * conflated app state with the Claude CLI's own config dir. As of the
 * Copilot-first refactor we move everything under `~/.agentmatrix/`
 * so the app's state is CLI-neutral and self-contained.
 *
 * Migration from the old layout is handled by `migrateStateStorage.ts`
 * which runs once at Electron startup.
 *
 * COST: this module performs no I/O at import time. The `ensureDir`
 * helper is the only function that touches disk, and it's idempotent
 * (single existsSync + optional mkdirSync).
 */

export const AGENTMATRIX_DIR = join(homedir(), '.agentmatrix');

// ── Long-lived config / cache files (migrated from ~/.claude/) ──
export const SETTINGS_PATH = join(AGENTMATRIX_DIR, 'settings.json');
export const NAMES_PATH = join(AGENTMATRIX_DIR, 'names.json');
export const TASKS_PATH = join(AGENTMATRIX_DIR, 'tasks.json');
export const ADO_PATH = join(AGENTMATRIX_DIR, 'ado.json');
export const ACTIVE_SESSIONS_PATH = join(AGENTMATRIX_DIR, 'active-sessions.json');
export const ORCHESTRATOR_PATH = join(AGENTMATRIX_DIR, 'orchestrator.json');

// ── Per-session ephemeral file directories ──
export const OUTPUT_DIR = join(AGENTMATRIX_DIR, 'output');
export const TASK_FILES_DIR = join(AGENTMATRIX_DIR, 'tasks');
export const REVIEW_DIR = join(AGENTMATRIX_DIR, 'reviews');
export const HANDOFF_DIR = join(AGENTMATRIX_DIR, 'handoffs');

/** Legacy paths (only used by the migrator). Do not consume elsewhere. */
export const LEGACY = {
  dir: join(homedir(), '.claude'),
  settings: join(homedir(), '.claude', 'agentmatrix-settings.json'),
  names: join(homedir(), '.claude', 'agentmatrix-names.json'),
  tasks: join(homedir(), '.claude', 'agentmatrix-tasks.json'),
  ado: join(homedir(), '.claude', 'agentmatrix-ado.json'),
  activeSessions: join(homedir(), '.claude', 'agentmatrix-active-sessions.json'),
  orchestrator: join(homedir(), '.claude', 'agentmatrix-orchestrator.json'),
} as const;

/**
 * Build a per-session output path under `~/.agentmatrix/output/`.
 * Used by PromptInjector for the inject-and-capture pattern.
 */
export function outputFilePath(sessionId: string): string {
  return join(OUTPUT_DIR, `${sessionId}.txt`);
}

/** Per-session task assignment markdown. */
export function taskFilePath(sessionId: string, taskId: string): string {
  return join(TASK_FILES_DIR, `${sessionId}-${taskId}.md`);
}

/** Per-session review comments markdown. */
export function reviewFilePath(sessionId: string): string {
  return join(REVIEW_DIR, `${sessionId}.md`);
}

/** Per-handoff context-transfer markdown. */
export function handoffFilePath(handoffId: string): string {
  return join(HANDOFF_DIR, `${handoffId}.md`);
}

/**
 * Ensure a directory exists. Idempotent. Single sync stat + conditional
 * mkdir — cheap enough to call on every write.
 */
export function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/** Ensure the root ~/.agentmatrix/ directory and all known subdirs. */
export function ensureAllDirs(): void {
  ensureDir(AGENTMATRIX_DIR);
  ensureDir(OUTPUT_DIR);
  ensureDir(TASK_FILES_DIR);
  ensureDir(REVIEW_DIR);
  ensureDir(HANDOFF_DIR);
}
