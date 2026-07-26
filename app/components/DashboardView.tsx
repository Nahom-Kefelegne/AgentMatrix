'use client';

import { useState, useCallback, useRef, useMemo, memo } from 'react';
import { motion } from 'framer-motion';
import type { SessionData } from '@/lib/types';
import { useSocketContext } from './SocketProvider';
import { perfRender } from '@/lib/perf';
import ContextBar from './ContextBar';
import AmbientOrbs from './AmbientOrbs';
import MatrixRain from './MatrixRain';
import type { CliType } from '@/lib/types';
import CliIcon from './CliIcon';

const STATUS: Record<string, { label: string; dotClass: string }> = {
  working: { label: 'Working', dotClass: 'status-dot--working' },
  idle: { label: 'Idle', dotClass: 'status-dot--idle' },
  meeting: { label: 'Meeting', dotClass: 'status-dot--meeting' },
  attention: { label: 'Needs You', dotClass: 'status-dot--attention' },
  done: { label: 'Done', dotClass: 'status-dot--done' },
};

// Per-status accent used for the card's left border, the status label, and the
// section header stripe — instant visual triage across the whole dashboard.
const STATUS_ACCENT: Record<string, string> = {
  working: '#34d399', meeting: '#a78bfa', attention: '#ef4444',
  done: '#3b82f6', idle: '#6b7280',
};

// Section order for the status-grouped dashboard — "Needs You" pinned to the top.
const GROUP_ORDER: { key: string; label: string }[] = [
  { key: 'attention', label: 'Needs You' },
  { key: 'working', label: 'Working' },
  { key: 'meeting', label: 'In Meeting' },
  { key: 'idle', label: 'Idle' },
  { key: 'done', label: 'Done' },
];

/** Compact "time since" label (e.g. "2m ago"), or null when no timestamp. */
function timeAgo(ts?: number): string | null {
  if (!ts) return null;
  const d = Math.floor((Date.now() - ts) / 1000);
  if (d < 5) return 'just now';
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

/** Compact elapsed label (e.g. "12m"), or null. Used for session age. */
function durationSince(ts?: number): string | null {
  if (!ts) return null;
  const d = Math.floor((Date.now() - ts) / 1000);
  if (d < 60) return `${d}s`;
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  return `${Math.floor(d / 86400)}d`;
}

interface FleetStats {
  total: number; working: number; attention: number;
  idle: number; done: number; meeting: number; files: number; avgCtx: number | null;
}

/** Fleet pulse: a slim strip of aggregate stats above the grid. */
function StatsStrip({ stats }: { stats: FleetStats }) {
  const cells: { label: string; value: string | number; color: string; alert?: boolean }[] = [
    { label: 'Sessions', value: stats.total, color: '#e4e4e7' },
    { label: 'Working', value: stats.working, color: STATUS_ACCENT.working },
    { label: 'Needs You', value: stats.attention, color: STATUS_ACCENT.attention, alert: stats.attention > 0 },
    { label: 'Idle', value: stats.idle, color: '#9ca3af' },
    { label: 'Done', value: stats.done, color: STATUS_ACCENT.done },
    { label: 'Files changed', value: stats.files, color: '#e4e4e7' },
    ...(stats.avgCtx !== null ? [{ label: 'Avg context', value: `${stats.avgCtx}%`, color: '#e4e4e7' }] : []),
  ];
  return (
    <div className="stats-strip">
      {cells.map(c => (
        <div key={c.label} className={`stat-cell ${c.alert ? 'stat-cell--alert' : ''}`}>
          <span className="stat-value" style={{ color: c.color }}>{c.value}</span>
          <span className="stat-label">{c.label}</span>
        </div>
      ))}
    </div>
  );
}

interface Props {
  sessions: Map<string, SessionData>;
  contextMap: Record<string, number>;
  onSelectSession: (id: string) => void;
}

export default function DashboardView({ sessions, contextMap, onSelectSession }: Props) {
  perfRender('DashboardView');
  const { socketRef } = useSocketContext();
  const all = useMemo(() => Array.from(sessions.values()), [sessions]);
  const [filter, setFilter] = useState('all');
  // Stable ref so handleSelect never changes identity, keeping
  // React.memo(SessionCard) effective across context-map / parent re-renders.
  const onSelectRef = useRef(onSelectSession); onSelectRef.current = onSelectSession;
  const handleSelect = useCallback((id: string) => { onSelectRef.current(id); }, []);

  // Fleet aggregates for the stats strip — one glance at the whole fleet.
  const stats = useMemo<FleetStats>(() => {
    const by = (st: string) => all.filter(s => s.status === st).length;
    let files = 0;
    for (const s of all) files += s.filesModified?.length ?? 0;
    const ctx = all.map(s => contextMap[s.id]).filter((v): v is number => typeof v === 'number');
    const avgCtx = ctx.length ? Math.round(ctx.reduce((a, b) => a + b, 0) / ctx.length) : null;
    return { total: all.length, working: by('working'), attention: by('attention'),
      idle: by('idle'), done: by('done'), meeting: by('meeting'), files, avgCtx };
  }, [all, contextMap]);

  const counts: Record<string, number> = {
    all: all.length, working: stats.working, idle: stats.idle, meeting: stats.meeting,
  };
  const filters = [
    { key: 'all', label: 'All' }, { key: 'working', label: 'Working' },
    { key: 'idle', label: 'Idle' }, { key: 'meeting', label: 'Meeting' },
  ].filter(f => f.key === 'all' || counts[f.key] > 0);

  const filtered = filter === 'all' ? all : all.filter(s => s.status === filter);
  // Newest-active first within any list.
  const byRecent = (a: SessionData, b: SessionData) =>
    (b.lastActivity ?? b.createdAt ?? 0) - (a.lastActivity ?? a.createdAt ?? 0);

  // Status-grouped sections (only when unfiltered) — replaces manual drag order.
  const groups = useMemo(() => GROUP_ORDER
    .map(g => ({ ...g, accent: STATUS_ACCENT[g.key], items: filtered.filter(s => s.status === g.key).sort(byRecent) }))
    .filter(g => g.items.length > 0), [filtered]);

  const isEmpty = filtered.length === 0;

  return (
    <div data-scroll-area style={{ height: '100vh', position: 'relative' }}
      className="overflow-y-auto dashboard-bg">
      {/* Efficient orbs: cheap gradient-only drift (see ambient-orbs.css). */}
      <AmbientOrbs />
      <div className="noise-overlay" />
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '56px 36px 80px', position: 'relative', zIndex: 2 }}>
        {stats.total > 0 && <StatsStrip stats={stats} />}

        <div className="filter-bar">
          {filters.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`filter-btn ${filter === f.key ? 'filter-btn--active' : ''}`}>
              {f.label}<span className="filter-count">{counts[f.key]}</span>
            </button>
          ))}
        </div>

        {isEmpty ? (
          <div style={{ textAlign: 'center', padding: '140px 0' }} className="subtle-text">
            <div style={{ fontSize: 48, marginBottom: 16 }}>○</div>
            <div style={{ fontSize: 16 }}>{all.length ? 'No matches' : 'No sessions running'}</div>
          </div>
        ) : filter === 'all' ? (
          groups.map(g => (
            <section key={g.key} className="dash-section">
              <div className="dash-section-header">
                <span className="dash-section-accent" style={{ background: g.accent }} />
                <span className="dash-section-title">{g.label}</span>
                <span className="dash-section-count">{g.items.length}</span>
              </div>
              <div className="dash-grid">
                {g.items.map(s => (
                  <SessionCard key={s.id} s={s} contextUsage={contextMap[s.id] ?? null}
                    onSelect={handleSelect} socketRef={socketRef} />
                ))}
              </div>
            </section>
          ))
        ) : (
          <div className="dash-grid">
            {[...filtered].sort(byRecent).map(s => (
              <SessionCard key={s.id} s={s} contextUsage={contextMap[s.id] ?? null}
                onSelect={handleSelect} socketRef={socketRef} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const SessionCard = memo(function SessionCard({ s, contextUsage, onSelect, socketRef }: {
  s: SessionData; contextUsage: number | null;
  onSelect: (id: string) => void; socketRef: React.RefObject<any>;
}) {
  perfRender('SessionCard');
  const meta = STATUS[s.status] || STATUS.idle;
  const working = s.status === 'working';
  const isActive = working || s.status === 'meeting' || s.status === 'attention';
  const accent = STATUS_ACCENT[s.status] ?? STATUS_ACCENT.idle;
  const [summaryRequested, setSummaryRequested] = useState(false);
  const hasSummary = s.summaryBullets && s.summaryBullets.length > 0;
  const loading = summaryRequested && !hasSummary;

  const handleSummary = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setSummaryRequested(true);
    socketRef.current?.emit('session:summary' as any, { sessionId: s.id });
  }, [socketRef, s.id]);

  const statusColor = STATUS_ACCENT[s.status];
  const filesCount = s.filesModified?.length ?? 0;
  const toolCount = s.recentActions?.length ?? 0;
  const agentCount = s.agents?.length ?? 0;
  const relTime = timeAgo(s.lastActivity ?? s.createdAt);
  const age = durationSince(s.createdAt);
  const hasChips = age || filesCount > 0 || toolCount > 0 || agentCount > 0;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ layout: { type: 'spring', stiffness: 500, damping: 35 }, default: { duration: 0.15 } }}
      onClick={() => onSelect(s.id)}
      style={{ cursor: 'pointer', borderLeft: `3px solid ${accent}` }}
      className={`session-card ${s.status === 'attention' ? 'session-card--attention' : ''} ${s.status === 'done' ? 'session-card--done' : ''} ${isActive ? 'session-card--active' : ''}`}
    >
      {/* Matrix rain behind content — only mounted for ACTIVE cards, which are
          the only ones that display it (idle/done keep it at opacity:0). This
          matters for perf: each instance runs ~100 infinite CSS animations that
          keep running even at opacity:0 (opacity doesn't pause animations), so
          mounting it for every card saturated the compositor. Gating on
          isActive means only the few active cards pay that cost. */}
      {isActive && <MatrixRain sessionId={s.id} />}

      <div className="session-card-body">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, marginRight: 12, minWidth: 0 }}>
            <CliIcon cliType={s.cliType} />
            <h3 className="session-name" style={{ margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</h3>
          </div>
          <div className="status-badge">
            <span className="status-label" style={{ color: statusColor }}>{meta.label}</span>
            <div className={`status-dot ${meta.dotClass}`} />
          </div>
        </div>

        <div className="session-subline">
          <span className="session-path">{s.cwd || '~'}</span>
          {relTime && <span className="session-reltime">· {relTime}</span>}
        </div>

        {s.statusReason && (s.status === 'attention' || s.status === 'done') && (
          <div className={`status-reason ${s.status === 'attention' ? 'status-reason--attention' : 'status-reason--done'}`}>
            {s.statusReason}
          </div>
        )}

        {hasChips && (
          <div className="card-chips">
            {age && <span className="chip" title="Session age">⏱ {age}</span>}
            {filesCount > 0 && <span className="chip" title="Files modified">▸ {filesCount} {filesCount === 1 ? 'file' : 'files'}</span>}
            {toolCount > 0 && <span className="chip" title="Recent tool calls">⚙ {toolCount}</span>}
            {agentCount > 0 && <span className="chip" title="Subagents">⧉ {agentCount} {agentCount === 1 ? 'agent' : 'agents'}</span>}
          </div>
        )}

        {contextUsage !== null && (
          <div style={{ marginTop: 12 }}>
            <ContextBar usage={contextUsage} compact />
          </div>
        )}

        {working && s.lastToolSummary && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
            className="working-strip">
            {s.lastToolSummary}
          </motion.div>
        )}

        {hasSummary && (
          <div style={{ marginTop: 12 }}>
            {s.summaryBullets!.map((b, j) => (
              <div key={j} className="summary-bullet">
                <span className="summary-bullet-dot">●</span>{b}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="session-card-footer">
        <span className="session-id">{s.id.slice(0, 8)}</span>
        <button onClick={handleSummary} disabled={loading || !!hasSummary}
          className={`summarize-btn ${hasSummary ? 'summarize-btn--done' : loading ? 'summarize-btn--loading' : ''}`}>
          {hasSummary ? '✓ Done' : loading ? 'Working...' : 'Summarize'}
        </button>
      </div>
    </motion.div>
  );
});
