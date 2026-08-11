/**
 * OrphanReaper — Cleans up CLI subprocesses that survived a previous app crash.
 *
 * The problem: When Electron force-quits / crashes / OOM-kills, it doesn't
 * propagate SIGTERM to its PTY children (Claude / Copilot CLI processes).
 * Those children stay alive, attached to their transcript files. On next app
 * launch, auto-resume spawns NEW processes for the same session IDs. Now
 * TWO processes write to the same `.jsonl` transcript with conflicting
 * parent UUIDs → broken chain → "thousands of lines of transcript disappear
 * on resume". It's also a memory leak — the orphan keeps growing.
 *
 * This module finds those orphans on startup and kills them BEFORE
 * auto-resume runs.
 */

import { spawnSync } from 'child_process';
import { existsSync, readdirSync, unlinkSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

interface OrphanProcess {
  pid: number;
  ppid: number;
  rssBytes: number;
  cliType: 'claude' | 'copilot' | 'agency';
  /** Session ID this process is attached to (the resume target / session-id flag). */
  sessionId: string | null;
  /** Raw command for logging. */
  command: string;
}

interface ProcessRow {
  pid: number;
  ppid: number;
  rssBytes: number;
  command: string;
}

function windowsProcessRows(): ProcessRow[] {
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize,CommandLine) | ConvertTo-Json -Compress',
    ],
    {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    },
  );
  if (result.status !== 0 || !result.stdout.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(result.stdout);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.flatMap(value => {
      if (!value || typeof value !== 'object') return [];
      const row = value as Record<string, unknown>;
      const pid = Number(row.ProcessId);
      const ppid = Number(row.ParentProcessId);
      const rssBytes = Number(row.WorkingSetSize);
      const command = typeof row.CommandLine === 'string' ? row.CommandLine : '';
      return Number.isInteger(pid) && Number.isInteger(ppid) && command
        ? [{ pid, ppid, rssBytes: Number.isFinite(rssBytes) ? rssBytes : 0, command }]
        : [];
    });
  } catch {
    return [];
  }
}

function unixProcessRows(): ProcessRow[] {
  const result = spawnSync('ps', ['-eo', 'pid,ppid,rss,command'], {
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) return [];
  return result.stdout.split('\n').flatMap(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
    return match
      ? [{
          pid: Number(match[1]),
          ppid: Number(match[2]),
          rssBytes: Number(match[3]) * 1024,
          command: match[4],
        }]
      : [];
  });
}

/** Get all running CLI processes (claude, copilot, agency wrappers). */
export function findRunningCliProcesses(): OrphanProcess[] {
  const orphans: OrphanProcess[] = [];

  for (const row of process.platform === 'win32' ? windowsProcessRows() : unixProcessRows()) {
    const { pid, ppid, rssBytes, command } = row;
    const normalized = command.replaceAll('\\', '/');

    // Match CLI binaries — be specific to avoid killing unrelated processes.
    // Claude: ~/.claude-cli/<version>/claude or claude on PATH with --session-id or --resume
    // Copilot: ~/.copilot-cli/<version>/copilot with --resume or --log-dir
    // Agency: ~/.config/agency/.../agency claude or agency copilot
    const isClaude = /(?:^|[\s/"])claude(?:\.exe)?["]?\s.*(?:--session-id|--resume)/i.test(normalized);
    const isCopilot = /(?:^|[\s/"])copilot(?:\.exe)?["]?\s.*(?:--resume|--session-id|--log-dir)/i.test(normalized);
    const isAgencyWrapper = /(?:^|[\s/"])agency(?:\.exe)?["]?\s+(claude|copilot)\b/i.test(normalized);

    if (!isClaude && !isCopilot && !isAgencyWrapper) continue;

    let cliType: 'claude' | 'copilot' | 'agency';
    if (isAgencyWrapper) cliType = 'agency';
    else if (isClaude) cliType = 'claude';
    else cliType = 'copilot';

    // Extract session ID — try in order of specificity:
    // 1. --session-id <uuid> (Claude new spawn — this is the AGENT'S session ID)
    // 2. --resume <uuid> (resume target — for agency wrappers and direct resumes)
    // 3. /session-state/<uuid>/ (Copilot session directory in --log-dir)
    let sessionId: string | null = null;

    // Prefer --session-id over --resume (a process with both is operating as session-id)
    const sessionIdMatch = command.match(/--session-id(?:\s+|=)([a-f0-9-]{36})/i);
    if (sessionIdMatch) {
      sessionId = sessionIdMatch[1];
    } else {
      const resumeMatch = command.match(/--resume[\s=]+([a-f0-9-]{36})/i);
      if (resumeMatch) sessionId = resumeMatch[1];
    }
    if (!sessionId) {
      const stateDirMatch = normalized.match(/\/session-state\/([a-f0-9-]{36})(?:\/|\b)/i);
      if (stateDirMatch) sessionId = stateDirMatch[1];
    }

    // Skip if we couldn't extract a session ID — likely not relevant.
    if (!sessionId && !isAgencyWrapper) continue;

    orphans.push({
      pid,
      ppid,
      rssBytes,
      cliType,
      sessionId,
      command: command.length > 200 ? command.slice(0, 200) + '...' : command,
    });
  }

  return orphans;
}

function sleepSync(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) { /* fallback spin */ }
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Kill a single PID synchronously (SIGTERM, then SIGKILL after grace). */
function killPidSync(pid: number, graceMs = 2000): boolean {
  if (process.platform === 'win32') {
    const result = spawnSync(
      'taskkill.exe',
      ['/PID', String(pid), '/T', '/F'],
      {
        encoding: 'utf-8',
        windowsHide: true,
        timeout: Math.max(5_000, graceMs + 1_000),
      },
    );
    return result.status === 0 || !isAlive(pid);
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // Process already dead or insufficient permissions
    return false;
  }

  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    sleepSync(100);
  }

  try { process.kill(pid, 'SIGKILL'); } catch { /* already dead */ }

  return true;
}

function shouldCleanupCopilotLocks(o: OrphanProcess): boolean {
  return o.cliType === 'copilot' || /\bagency\s+copilot\b/.test(o.command);
}

function cleanupCopilotLocks(sessionId: string | null): number {
  if (!sessionId) return 0;
  const sessionDir = join(homedir(), '.copilot', 'session-state', sessionId);
  if (!existsSync(sessionDir)) return 0;

  let removed = 0;
  try {
    for (const file of readdirSync(sessionDir)) {
      if (!/^inuse\.\d+\.lock$/.test(file)) continue;
      try {
        unlinkSync(join(sessionDir, file));
        removed++;
      } catch { /* lock disappeared or is owned by another process */ }
    }
  } catch { /* session dir disappeared */ }
  return removed;
}

/**
 * Kill all CLI processes that are NOT owned by the current Electron process.
 * Anything spawned by THIS Electron run has Electron's PID as ancestor and
 * we leave those alone; everything else is from a previous (crashed) run.
 *
 * This is the safe nuclear option: on app startup, kill anything from a
 * previous instance before we auto-resume.
 */
export function reapOrphansOnStartup(): { killed: number; freedBytes: number; details: string[] } {
  const myPid = process.pid;
  const orphans = findRunningCliProcesses();

  // Build a set of PIDs that are descendants of THIS Electron process.
  // Anything spawned in this Electron run has us in its ancestor chain.
  const myDescendants = new Set<number>();
  myDescendants.add(myPid);

  // Build a parent-map for cheap ancestor walks
  const parentOf = new Map<number, number>();
  for (const o of orphans) parentOf.set(o.pid, o.ppid);

  // Iteratively expand myDescendants until stable
  let changed = true;
  while (changed) {
    changed = false;
    for (const o of orphans) {
      if (myDescendants.has(o.pid)) continue;
      if (myDescendants.has(o.ppid)) {
        myDescendants.add(o.pid);
        changed = true;
      }
    }
  }

  const toKill = orphans.filter(o => !myDescendants.has(o.pid));
  const details: string[] = [];
  let freed = 0;

  for (const o of toKill) {
    const ageMb = (o.rssBytes / 1024 / 1024).toFixed(0);
    details.push(`  killed ${o.cliType} pid=${o.pid} session=${(o.sessionId || 'none').slice(0, 8)} rss=${ageMb}MB`);
    if (killPidSync(o.pid)) {
      freed += o.rssBytes;
      if (shouldCleanupCopilotLocks(o)) {
        const removed = cleanupCopilotLocks(o.sessionId);
        if (removed > 0) {
          details.push(`    removed ${removed} stale Copilot lock file(s) for ${(o.sessionId || 'none').slice(0, 8)}`);
        }
      }
    }
  }

  return { killed: toKill.length, freedBytes: freed, details };
}

/**
 * Kill orphans for SPECIFIC session IDs that we're about to auto-resume.
 * This is more targeted than `reapOrphansOnStartup`: it ONLY kills processes
 * matching session IDs we're about to spawn, leaving unrelated processes alone.
 *
 * Use this when you don't want to be too aggressive about killing things you
 * didn't spawn (e.g., user has another claude session running outside Agent
 * Matrix that they don't want killed).
 */
export function reapOrphansForSessions(sessionIds: string[]): { killed: number; freedBytes: number; details: string[] } {
  const orphans = findRunningCliProcesses();
  const targetIds = new Set(sessionIds);

  const details: string[] = [];
  let freed = 0;
  let killed = 0;

  for (const o of orphans) {
    if (!o.sessionId || !targetIds.has(o.sessionId)) continue;
    // This targeted path runs after PtyManager has attempted graceful shutdown
    // and before a replacement is spawned. Any surviving matching process,
    // including a direct child of this Electron host, belongs to the old PTY.

    const rssMb = (o.rssBytes / 1024 / 1024).toFixed(0);
    details.push(`  killed ${o.cliType} pid=${o.pid} session=${o.sessionId.slice(0, 8)} rss=${rssMb}MB`);
    if (killPidSync(o.pid)) {
      freed += o.rssBytes;
      killed++;
      if (shouldCleanupCopilotLocks(o)) {
        const removed = cleanupCopilotLocks(o.sessionId);
        if (removed > 0) {
          details.push(`    removed ${removed} stale Copilot lock file(s) for ${o.sessionId.slice(0, 8)}`);
        }
      }
    }
  }

  const remainingCopilotSessions = new Set(
    findRunningCliProcesses()
      .filter(processInfo => processInfo.cliType === 'copilot' && processInfo.sessionId)
      .map(processInfo => processInfo.sessionId!),
  );
  for (const sessionId of targetIds) {
    if (remainingCopilotSessions.has(sessionId)) continue;
    const removed = cleanupCopilotLocks(sessionId);
    if (removed > 0) {
      details.push(`    removed ${removed} stale Copilot lock file(s) for ${sessionId.slice(0, 8)}`);
    }
  }

  return { killed, freedBytes: freed, details };
}

/** Pretty-print the reaper result for logging. */
export function logReapResult(label: string, result: { killed: number; freedBytes: number; details: string[] }) {
  if (result.killed === 0) {
    console.log(`[orphan-reaper] ${label}: no orphans found`);
    return;
  }
  const freedMb = (result.freedBytes / 1024 / 1024).toFixed(0);
  console.log(`[orphan-reaper] ${label}: killed ${result.killed} orphan process(es), freed ~${freedMb}MB`);
  for (const line of result.details) console.log(line);
}
