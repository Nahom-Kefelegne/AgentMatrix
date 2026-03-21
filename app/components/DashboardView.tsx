'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { SessionData } from '@/lib/types';
import { useSocketContext } from './SocketProvider';
import ContextBar from './ContextBar';

const STATUS: Record<string, { label: string; dotClass: string }> = {
  working: { label: 'Working', dotClass: 'status-dot--working' },
  idle: { label: 'Idle', dotClass: 'status-dot--idle' },
  meeting: { label: 'Meeting', dotClass: 'status-dot--meeting' },
  attention: { label: 'Needs You', dotClass: 'status-dot--attention' },
  done: { label: 'Done', dotClass: 'status-dot--done' },
};

function ago(ts: number): string {
  const d = Math.floor((Date.now() - ts) / 1000);
  if (d < 5) return 'just now';
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  return d < 86400 ? `${Math.floor(d / 3600)}h ago` : `${Math.floor(d / 86400)}d ago`;
}

interface Props {
  sessions: Map<string, SessionData>;
  contextMap: Record<string, number>;
  onSelectSession: (id: string) => void;
}

export default function DashboardView({ sessions, contextMap, onSelectSession }: Props) {
  const { socketRef } = useSocketContext();
  const all = Array.from(sessions.values());
  const [filter, setFilter] = useState('all');
  const [, tick] = useState(0);
  useEffect(() => { const i = setInterval(() => tick(t => t + 1), 5000); return () => clearInterval(i); }, []);

  const list = filter === 'all' ? all : all.filter(s => s.status === filter);
  const counts: Record<string, number> = {
    all: all.length, working: all.filter(s => s.status === 'working').length,
    idle: all.filter(s => s.status === 'idle').length, meeting: all.filter(s => s.status === 'meeting').length,
  };

  const filters = [
    { key: 'all', label: 'All' }, { key: 'working', label: 'Working' },
    { key: 'idle', label: 'Idle' }, { key: 'meeting', label: 'Meeting' },
  ].filter(f => f.key === 'all' || counts[f.key] > 0);

  return (
    <div data-scroll-area style={{ height: '100vh' }}
      className="overflow-y-auto">
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '72px 36px 80px' }}>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="filter-bar">
          {filters.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`filter-btn ${filter === f.key ? 'filter-btn--active' : ''}`}>
              {f.label}<span className="filter-count">{counts[f.key]}</span>
            </button>
          ))}
        </motion.div>

        {list.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '140px 0' }} className="subtle-text">
            <div style={{ fontSize: 48, marginBottom: 16 }}>○</div>
            <div style={{ fontSize: 16 }}>{all.length ? 'No matches' : 'No sessions running'}</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 20 }}>
            <AnimatePresence mode="popLayout">
              {list.map((s, i) => (
                <SessionCard key={s.id} s={s} i={i}
                  contextUsage={contextMap[s.id] ?? null}
                  onClick={() => onSelectSession(s.id)} socketRef={socketRef} />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}

function SessionCard({ s, i, contextUsage, onClick, socketRef }: {
  s: SessionData; i: number; contextUsage: number | null;
  onClick: () => void; socketRef: React.RefObject<any>;
}) {
  const meta = STATUS[s.status] || STATUS.idle;
  const working = s.status === 'working';
  const [summaryRequested, setSummaryRequested] = useState(false);
  const hasSummary = s.summaryBullets && s.summaryBullets.length > 0;
  const loading = summaryRequested && !hasSummary;

  const handleSummary = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setSummaryRequested(true);
    socketRef.current?.emit('session:summary', { sessionId: s.id });
  }, [socketRef, s.id]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.35, delay: i * 0.05, type: 'spring', stiffness: 300, damping: 28 }}
      onClick={onClick}
      className={`session-card ${working ? 'session-card--working' : ''} ${s.status === 'attention' ? 'session-card--attention' : ''} ${s.status === 'done' ? 'session-card--done' : ''}`}
    >
      <div className="session-card-body">
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <h3 className="session-name" style={{ flex: 1, marginRight: 16 }}>{s.name}</h3>
          <div className="status-badge">
            <span className="status-label" style={{
              color: working ? '#34d399' : s.status === 'meeting' ? '#a78bfa'
                : s.status === 'attention' ? '#f59e0b' : s.status === 'done' ? '#3b82f6' : undefined
            }}>
              {meta.label}
            </span>
            <div className={`status-dot ${meta.dotClass}`} />
          </div>
        </div>

        {/* Path */}
        <div className="session-path">{s.cwd || '~'}</div>

        {/* Status reason (attention/done) */}
        {s.statusReason && (s.status === 'attention' || s.status === 'done') && (
          <div className={`status-reason ${s.status === 'attention' ? 'status-reason--attention' : 'status-reason--done'}`}>
            {s.statusReason}
          </div>
        )}

        {/* Context bar */}
        {contextUsage !== null && (
          <div style={{ marginTop: 14 }}>
            <ContextBar usage={contextUsage} compact />
          </div>
        )}

        {/* Working indicator */}
        {working && s.lastToolSummary && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
            className="working-strip">
            {s.lastToolSummary}
          </motion.div>
        )}

        {/* Summary */}
        {hasSummary && (
          <div style={{ marginTop: 14 }}>
            {s.summaryBullets!.map((b, j) => (
              <div key={j} className="summary-bullet">
                <span className="summary-bullet-dot">●</span>
                {b}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="session-card-footer">
        <span className="session-id">{s.id.slice(0, 8)}</span>
        <button onClick={handleSummary} disabled={loading || !!hasSummary}
          className={`summarize-btn ${hasSummary ? 'summarize-btn--done' : loading ? 'summarize-btn--loading' : ''}`}>
          {hasSummary ? '✓ Done' : loading ? 'Working...' : 'Summarize'}
        </button>
      </div>
    </motion.div>
  );
}
