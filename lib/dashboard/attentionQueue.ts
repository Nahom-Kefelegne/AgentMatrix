/**
 * Attention-queue model for the "Mission Control" dashboard.
 *
 * This is the THEME-INDEPENDENT logic layer: pure functions that turn the raw
 * session fleet into a triage model — a prioritized queue of moments that need
 * the human, plus muted lanes for agents that are healthy. No React, no styling,
 * no DOM. The UI layer consumes `deriveDashboardModel()` and decides how to draw.
 *
 * Design rationale (see plan.md): competitors show every agent as an equal card,
 * which encourages babysitting. We instead ROUTE ATTENTION — surface only what is
 * actionable and mute the rest — targeting the researched pain points:
 *   babysitting/idle uncertainty, approval fatigue, the 80% stall, context rot,
 *   losing track across parallel sessions.
 */

import type { SessionData, CliType, Action } from '@/lib/types';

// ─────────────────────────────────────────────────────────────────────────────
// Tunables
// ─────────────────────────────────────────────────────────────────────────────

export interface AttentionThresholds {
  /** contextUsage (%) at or above which a session is "critical" (compact now). */
  contextCritical: number;
  /** contextUsage (%) at or above which a session is a soft "warning". */
  contextWarning: number;
  /** ms of no activity while `working` after which a session is "possibly stuck". */
  stuckAfterMs: number;
  /** Sparkline: number of time buckets. */
  sparklineBuckets: number;
  /** Sparkline: total window covered by the buckets, in ms. */
  sparklineWindowMs: number;
}

export const DEFAULT_THRESHOLDS: AttentionThresholds = {
  contextCritical: 90,
  contextWarning: 80,
  stuckAfterMs: 3 * 60_000,
  sparklineBuckets: 8,
  sparklineWindowMs: 5 * 60_000,
};

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Kinds of attention moments, in priority order (index 0 = most urgent).
 * `approve-command` is Phase 2 (needs orchestrator to route risky prompts here
 * instead of auto-accepting); everything else is derivable from existing data.
 */
export type AttentionKind =
  | 'approve-command'
  | 'needs-decision'
  | 'context-critical'
  | 'ready-to-review'
  | 'context-warning'
  | 'possibly-stuck';

/** Priority rank per kind — lower sorts first. */
export const KIND_PRIORITY: Record<AttentionKind, number> = {
  'approve-command': 0,
  'needs-decision': 1,
  'context-critical': 2,
  'ready-to-review': 3,
  'context-warning': 4,
  'possibly-stuck': 5,
};

/** Human-facing short label per kind (UI may override, but this keeps copy consistent). */
export const KIND_LABEL: Record<AttentionKind, string> = {
  'approve-command': 'Wants to run a command',
  'needs-decision': 'Needs a decision',
  'context-critical': 'Context almost full',
  'ready-to-review': 'Ready to review',
  'context-warning': 'Context filling up',
  'possibly-stuck': 'Possibly stuck',
};

/** A single actionable moment surfaced to the human. One per session (the most urgent reason). */
export interface AttentionItem {
  /** Stable identity across renders: `${kind}:${sessionId}`. */
  id: string;
  sessionId: string;
  sessionName: string;
  cliType?: CliType;
  kind: AttentionKind;
  /** Sort key — lower is more urgent. Derived from KIND_PRIORITY. */
  priority: number;
  /** Short label, e.g. "Needs a decision". */
  label: string;
  /** Context line: the agent's question, the pending command, or a reason. */
  detail?: string;
  /** For "review" items: number of files changed, if known. */
  filesChanged?: number;
  /** contextUsage (%) at derivation time, when relevant. */
  contextUsage?: number;
  /** Timestamp the session entered this state (best-effort) — drives "waiting 4m". */
  waitingSince?: number;
  cwd?: string;
}

/** A muted lane entry — an agent that is alive but does NOT need the human. */
export interface LaneItem {
  session: SessionData;
  contextUsage: number | null;
  /** Per-bucket activity intensity (0..1), oldest→newest, length = sparklineBuckets. */
  sparkline: number[];
  /** Last activity timestamp (lastActivity ?? createdAt). */
  lastActivity: number;
  /** Most recent tool label, if any. */
  lastAction?: string;
}

export interface FleetStats {
  total: number;
  needsYou: number;
  working: number;
  idle: number;
  meeting: number;
  done: number;
  /** Sum of filesModified across the fleet. */
  filesChanged: number;
  /** Mean contextUsage across sessions that report it, rounded; null if none. */
  avgContext: number | null;
  /** Max contextUsage across the fleet; null if none. */
  peakContext: number | null;
}

export interface DashboardModel {
  stats: FleetStats;
  /** Sorted, one entry per session that needs attention. */
  queue: AttentionItem[];
  /** Every managed session, including queued ones. Newest-active first. */
  fleet: LaneItem[];
  /** Active but healthy (working/meeting, not stuck, not otherwise queued). Newest-active first. */
  working: LaneItem[];
  /** Idle and quiet (not queued). Newest-active first. */
  idle: LaneItem[];
}

export interface DeriveOptions {
  thresholds?: Partial<AttentionThresholds>;
  /** Injected clock for deterministic tests; defaults to Date.now(). */
  now?: number;
  /**
   * Sessions with a pending risky command keyed by id → the command string.
   * Phase 2 wiring; when omitted, no `approve-command` items are produced.
   */
  pendingApprovals?: Record<string, string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Derivation
// ─────────────────────────────────────────────────────────────────────────────

/** Resolve a session's effective context usage, preferring the live map over the snapshot. */
function contextOf(s: SessionData, contextMap: Record<string, number>): number | null {
  const live = contextMap[s.id];
  if (typeof live === 'number') return live;
  if (typeof s.contextUsage === 'number') return s.contextUsage;
  return null;
}

/** Best-effort "when did this session last do something" timestamp. */
function lastActivityOf(s: SessionData): number {
  return s.lastActivity ?? s.createdAt ?? 0;
}

/**
 * Determine the single most-urgent attention reason for a session, or null if it
 * does not currently need the human. One reason per session keeps the queue a
 * clean "N agents need you" list rather than a pile of duplicate rows.
 */
function deriveKind(
  s: SessionData,
  ctx: number | null,
  now: number,
  t: AttentionThresholds,
  pendingCmd: string | undefined,
): AttentionKind | null {
  if (pendingCmd) return 'approve-command';
  if (s.status === 'attention') return 'needs-decision';
  if (ctx !== null && ctx >= t.contextCritical) return 'context-critical';
  if (s.status === 'done') return 'ready-to-review';
  if (ctx !== null && ctx >= t.contextWarning) return 'context-warning';
  if (s.status === 'working' && now - lastActivityOf(s) >= t.stuckAfterMs) return 'possibly-stuck';
  return null;
}

/** Build the AttentionItem for a resolved kind. */
function buildItem(
  s: SessionData,
  kind: AttentionKind,
  ctx: number | null,
  pendingCmd: string | undefined,
): AttentionItem {
  const detail =
    kind === 'approve-command' ? pendingCmd :
    kind === 'needs-decision' ? (s.statusReason ?? s.lastToolSummary) :
    kind === 'ready-to-review' ? (s.statusReason ?? s.lastToolSummary) :
    kind === 'context-critical' || kind === 'context-warning' ? `Context at ${ctx}%` :
    kind === 'possibly-stuck' ? (s.currentTool ? `Still on ${s.currentTool}` : s.lastToolSummary) :
    undefined;

  return {
    id: `${kind}:${s.id}`,
    sessionId: s.id,
    sessionName: s.name,
    cliType: s.cliType,
    kind,
    priority: KIND_PRIORITY[kind],
    label: KIND_LABEL[kind],
    detail: detail || undefined,
    filesChanged: kind === 'ready-to-review' ? (s.filesModified?.length ?? 0) : undefined,
    contextUsage: ctx ?? undefined,
    waitingSince: lastActivityOf(s) || undefined,
    cwd: s.cwd,
  };
}

/**
 * Bucket a session's recent tool actions into a normalized activity sparkline.
 * Oldest bucket first; each value is 0..1 (relative to the busiest bucket).
 * Empty history → all zeros, so the UI can render a flat baseline.
 */
export function activitySparkline(
  actions: Action[] | undefined,
  now: number,
  buckets: number,
  windowMs: number,
): number[] {
  const out = new Array<number>(buckets).fill(0);
  if (!actions || actions.length === 0 || buckets <= 0 || windowMs <= 0) return out;
  const bucketMs = windowMs / buckets;
  const start = now - windowMs;
  for (const a of actions) {
    if (typeof a.timestamp !== 'number' || a.timestamp < start || a.timestamp > now) continue;
    let idx = Math.floor((a.timestamp - start) / bucketMs);
    if (idx < 0) idx = 0;
    if (idx >= buckets) idx = buckets - 1;
    out[idx] += 1;
  }
  const peak = Math.max(...out);
  if (peak <= 0) return out;
  for (let i = 0; i < buckets; i++) out[i] = out[i] / peak;
  return out;
}

function toLaneItem(
  s: SessionData,
  contextMap: Record<string, number>,
  now: number,
  t: AttentionThresholds,
): LaneItem {
  return {
    session: s,
    contextUsage: contextOf(s, contextMap),
    sparkline: activitySparkline(s.recentActions, now, t.sparklineBuckets, t.sparklineWindowMs),
    lastActivity: lastActivityOf(s),
    lastAction: s.currentTool || s.lastToolSummary || s.recentActions?.[0]?.summary,
  };
}

/** Sort attention items: by priority asc, then longest-waiting first (older ts first). */
function sortQueue(a: AttentionItem, b: AttentionItem): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  return (a.waitingSince ?? Infinity) - (b.waitingSince ?? Infinity);
}

/** Newest-active first. */
function sortLaneByRecent(a: LaneItem, b: LaneItem): number {
  return b.lastActivity - a.lastActivity;
}

export function computeFleetStats(
  sessions: SessionData[],
  contextMap: Record<string, number>,
  needsYou: number,
): FleetStats {
  let filesChanged = 0;
  let ctxSum = 0;
  let ctxCount = 0;
  let peak: number | null = null;
  const by = { working: 0, idle: 0, meeting: 0, done: 0, attention: 0 };

  for (const s of sessions) {
    filesChanged += s.filesModified?.length ?? 0;
    if (s.status in by) by[s.status as keyof typeof by] += 1;
    const ctx = contextOf(s, contextMap);
    if (ctx !== null) {
      ctxSum += ctx;
      ctxCount += 1;
      peak = peak === null ? ctx : Math.max(peak, ctx);
    }
  }

  return {
    total: sessions.length,
    needsYou,
    working: by.working,
    idle: by.idle,
    meeting: by.meeting,
    done: by.done,
    filesChanged,
    avgContext: ctxCount ? Math.round(ctxSum / ctxCount) : null,
    peakContext: peak,
  };
}

/**
 * The one entry point the UI calls. Pure: same inputs → same output (given `now`).
 */
export function deriveDashboardModel(
  sessions: SessionData[],
  contextMap: Record<string, number> = {},
  opts: DeriveOptions = {},
): DashboardModel {
  const t: AttentionThresholds = { ...DEFAULT_THRESHOLDS, ...(opts.thresholds ?? {}) };
  const now = opts.now ?? Date.now();
  const pending = opts.pendingApprovals ?? {};

  const queue: AttentionItem[] = [];
  const queuedIds = new Set<string>();

  for (const s of sessions) {
    const ctx = contextOf(s, contextMap);
    const kind = deriveKind(s, ctx, now, t, pending[s.id]);
    if (kind) {
      queue.push(buildItem(s, kind, ctx, pending[s.id]));
      queuedIds.add(s.id);
    }
  }
  queue.sort(sortQueue);

  const working: LaneItem[] = [];
  const idle: LaneItem[] = [];
  for (const s of sessions) {
    if (queuedIds.has(s.id)) continue; // it's in the attention queue; don't double-list
    if (s.status === 'working' || s.status === 'meeting') {
      working.push(toLaneItem(s, contextMap, now, t));
    } else {
      idle.push(toLaneItem(s, contextMap, now, t)); // idle / (non-done) leftovers
    }
  }
  working.sort(sortLaneByRecent);
  idle.sort(sortLaneByRecent);
  const fleet = sessions
    .map(session => toLaneItem(session, contextMap, now, t))
    .sort(sortLaneByRecent);

  const stats = computeFleetStats(sessions, contextMap, queue.length);

  return { stats, queue, fleet, working, idle };
}
