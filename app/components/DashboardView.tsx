'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { SessionData } from '@/lib/types';
import { useSocketContext } from './SocketProvider';
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
  const [order, setOrder] = useState<string[]>([]);
  const dragItem = useRef<string | null>(null);
  const dragOverItem = useRef<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [, tick] = useState(0);
  useEffect(() => { const i = setInterval(() => tick(t => t + 1), 5000); return () => clearInterval(i); }, []);

  const sessionIds = all.map(s => s.id).join(',');
  useEffect(() => {
    const ids = sessionIds.split(',').filter(Boolean);
    const currentIds = new Set(ids);
    setOrder(prev => {
      const kept = prev.filter(id => currentIds.has(id));
      const newIds = ids.filter(id => !prev.includes(id));
      const merged = [...kept, ...newIds];
      if (merged.length === prev.length && merged.every((id, i) => prev[i] === id)) return prev;
      return merged;
    });
  }, [sessionIds]);

  const filtered = filter === 'all' ? all : all.filter(s => s.status === filter);
  const filteredIds = new Set(filtered.map(s => s.id));
  const orderedList = order.filter(id => filteredIds.has(id)).map(id => sessions.get(id)!).filter(Boolean);

  const counts: Record<string, number> = {
    all: all.length, working: all.filter(s => s.status === 'working').length,
    idle: all.filter(s => s.status === 'idle').length, meeting: all.filter(s => s.status === 'meeting').length,
  };
  const filters = [
    { key: 'all', label: 'All' }, { key: 'working', label: 'Working' },
    { key: 'idle', label: 'Idle' }, { key: 'meeting', label: 'Meeting' },
  ].filter(f => f.key === 'all' || counts[f.key] > 0);

  const handleDragStart = (e: React.DragEvent, id: string) => {
    dragItem.current = id;
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!dragItem.current || dragItem.current === id) { setDragOverId(null); return; }
    setDragOverId(id);
    if (dragOverItem.current === id) return;
    dragOverItem.current = id;
    setOrder(prev => {
      const from = prev.indexOf(dragItem.current!);
      const to = prev.indexOf(id);
      if (from === -1 || to === -1) return prev;
      const next = [...prev];
      next.splice(from, 1);
      next.splice(to, 0, dragItem.current!);
      return next;
    });
  };
  const handleDragEnd = () => {
    dragItem.current = null;
    dragOverItem.current = null;
    setDragId(null);
    setDragOverId(null);
  };

  return (
    <div data-scroll-area style={{ height: '100vh', position: 'relative' }}
      className="overflow-y-auto dashboard-bg">
      <AmbientOrbs />
      <div className="noise-overlay" />
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '72px 36px 80px', position: 'relative', zIndex: 2 }}>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="filter-bar">
          {filters.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`filter-btn ${filter === f.key ? 'filter-btn--active' : ''}`}>
              {f.label}<span className="filter-count">{counts[f.key]}</span>
            </button>
          ))}
        </motion.div>

        {orderedList.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '140px 0' }} className="subtle-text">
            <div style={{ fontSize: 48, marginBottom: 16 }}>○</div>
            <div style={{ fontSize: 16 }}>{all.length ? 'No matches' : 'No sessions running'}</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 20 }}>
            {orderedList.map((s, i) => (
              <SessionCard key={s.id} s={s} i={i}
                contextUsage={contextMap[s.id] ?? null}
                onClick={() => { if (!dragId) onSelectSession(s.id); }}
                socketRef={socketRef}
                isDragging={dragId === s.id}
                onDragStart={(e) => handleDragStart(e, s.id)}
                onDragOver={(e) => handleDragOver(e, s.id)}
                onDragEnd={handleDragEnd} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SessionCard({ s, i, contextUsage, onClick, socketRef, isDragging, onDragStart, onDragOver, onDragEnd }: {
  s: SessionData; i: number; contextUsage: number | null;
  onClick: () => void; socketRef: React.RefObject<any>;
  isDragging?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
}) {
  const meta = STATUS[s.status] || STATUS.idle;
  const working = s.status === 'working';
  const isActive = working || s.status === 'meeting' || s.status === 'attention';
  const [summaryRequested, setSummaryRequested] = useState(false);
  const hasSummary = s.summaryBullets && s.summaryBullets.length > 0;
  const loading = summaryRequested && !hasSummary;

  const handleSummary = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setSummaryRequested(true);
    socketRef.current?.emit('session:summary' as any, { sessionId: s.id });
  }, [socketRef, s.id]);

  const statusColor = working ? '#34d399' : s.status === 'meeting' ? '#a78bfa'
    : s.status === 'attention' ? '#ef4444' : s.status === 'done' ? '#3b82f6' : undefined;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: isDragging ? 0.3 : 1, y: 0, scale: isDragging ? 0.98 : 1 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ layout: { type: 'spring', stiffness: 500, damping: 35 }, default: { duration: 0.15 } }}
      {...{ draggable: true, onDragStart: onDragStart as any, onDragOver: onDragOver as any, onDragEnd: onDragEnd as any }}
      onClick={onClick}
      style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
      className={`session-card ${s.status === 'attention' ? 'session-card--attention' : ''} ${s.status === 'done' ? 'session-card--done' : ''} ${isActive ? 'session-card--active' : ''}`}
    >
      {/* Matrix rain behind content */}
      <MatrixRain sessionId={s.id} />

      <div className="session-card-body">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, marginRight: 16 }}>
            <CliIcon cliType={s.cliType} />
            <h3 className="session-name" style={{ margin: 0 }}>{s.name}</h3>
          </div>
          <div className="status-badge">
            <span className="status-label" style={{ color: statusColor }}>{meta.label}</span>
            <div className={`status-dot ${meta.dotClass}`} />
          </div>
        </div>

        <div className="session-path">{s.cwd || '~'}</div>

        {s.statusReason && (s.status === 'attention' || s.status === 'done') && (
          <div className={`status-reason ${s.status === 'attention' ? 'status-reason--attention' : 'status-reason--done'}`}>
            {s.statusReason}
          </div>
        )}

        {contextUsage !== null && (
          <div style={{ marginTop: 14 }}>
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
          <div style={{ marginTop: 14 }}>
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
}
