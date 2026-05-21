import { existsSync, copyFileSync, renameSync } from 'fs';
import {
  AGENTMATRIX_DIR,
  SETTINGS_PATH,
  NAMES_PATH,
  TASKS_PATH,
  ADO_PATH,
  ACTIVE_SESSIONS_PATH,
  ORCHESTRATOR_PATH,
  LEGACY,
  ensureAllDirs,
} from './paths';

/**
 * One-shot migrator: move Agent Matrix's long-lived state files from
 * `~/.claude/agentmatrix-*.json` into `~/.agentmatrix/*.json`.
 *
 * Design notes:
 * - Idempotent. Safe to run on every startup. Bails out fast (single
 *   existsSync check) if the new dir already exists.
 * - Per-file: only migrates when the legacy file exists AND the new
 *   file does NOT exist, so user changes made post-migration are never
 *   clobbered.
 * - Uses `copyFile + rename` semantics (try rename first for atomicity,
 *   fall back to copy then unlink) to survive cross-device cases on
 *   Windows where ~/.claude and ~/.agentmatrix may sit on different
 *   volumes (rare but possible with junction points).
 * - We deliberately keep the legacy file after copy for two releases,
 *   so users can downgrade if something goes wrong. Cleanup of legacy
 *   files is a separate task (tracked in the design doc).
 *
 * COST: one stat per file in the typical no-op case (~6 files). When
 * actually migrating: 6 small file copies. All <1ms.
 */
export function migrateStateStorage(): { migrated: string[]; skipped: string[] } {
  const migrated: string[] = [];
  const skipped: string[] = [];

  ensureAllDirs();

  const items: Array<{ name: string; legacy: string; modern: string }> = [
    { name: 'settings.json', legacy: LEGACY.settings, modern: SETTINGS_PATH },
    { name: 'names.json', legacy: LEGACY.names, modern: NAMES_PATH },
    { name: 'tasks.json', legacy: LEGACY.tasks, modern: TASKS_PATH },
    { name: 'ado.json', legacy: LEGACY.ado, modern: ADO_PATH },
    { name: 'active-sessions.json', legacy: LEGACY.activeSessions, modern: ACTIVE_SESSIONS_PATH },
    { name: 'orchestrator.json', legacy: LEGACY.orchestrator, modern: ORCHESTRATOR_PATH },
  ];

  for (const item of items) {
    if (!existsSync(item.legacy)) {
      skipped.push(item.name);
      continue;
    }
    if (existsSync(item.modern)) {
      // Modern file already exists — user has already migrated and may
      // have updated it since. Don't clobber.
      skipped.push(item.name);
      continue;
    }
    try {
      // Try atomic rename first (same-device fast path).
      renameSync(item.legacy, item.modern);
      migrated.push(item.name);
    } catch {
      // Cross-device or permission: fall back to copy. Leave legacy in
      // place so a re-run still has a source if something fails next.
      try {
        copyFileSync(item.legacy, item.modern);
        migrated.push(item.name);
      } catch {
        skipped.push(item.name);
      }
    }
  }

  if (migrated.length > 0) {
    console.log(
      `[migrateStateStorage] Migrated ${migrated.length} file(s) ` +
      `from ~/.claude/agentmatrix-* to ${AGENTMATRIX_DIR}: ${migrated.join(', ')}`,
    );
  }

  return { migrated, skipped };
}
