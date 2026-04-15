'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { SessionData } from '@/lib/types';
import { useSocketContext } from './SocketProvider';
import ContextBar from './ContextBar';
import AmbientOrbs from './AmbientOrbs';

import MatrixRain from './MatrixRain';
import type { CliType } from '@/lib/types';

/** CLI icon metadata for visual differentiation */
const CLI_ICON_META: Record<string, { svg: string; color: string; name: string }> = {
  claude: {
    svg: `<svg width="14" height="14" viewBox="0 0 248 248" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M52.4285 162.873L98.7844 136.879L99.5485 134.602L98.7844 133.334H96.4921L88.7237 132.862L62.2346 132.153L39.3113 131.207L17.0249 130.026L11.4214 128.844L6.2 121.873L6.7094 118.447L11.4214 115.257L18.171 115.847L33.0711 116.911L55.485 118.447L71.6586 119.392L95.728 121.873H99.5485L100.058 120.337L98.7844 119.392L97.7656 118.447L74.5877 102.732L49.4995 86.1905L36.3823 76.62L29.3779 71.7757L25.8121 67.2858L24.2839 57.3608L30.6515 50.2716L39.3113 50.8623L41.4763 51.4531L50.2636 58.1879L68.9842 72.7209L93.4357 90.6804L97.0015 93.6343L98.4374 92.6652L98.6571 91.9801L97.0015 89.2625L83.757 65.2772L69.621 40.8192L63.2534 30.6579L61.5978 24.632C60.9565 22.1032 60.579 20.0111 60.579 17.4246L67.8381 7.49965L71.9133 6.19995L81.7193 7.49965L85.7946 11.0443L91.9074 24.9865L101.714 46.8451L116.996 76.62L121.453 85.4816L123.873 93.6343L124.764 96.1155H126.292V94.6976L127.566 77.9197L129.858 57.3608L132.15 30.8942L132.915 23.4505L136.608 14.4708L143.994 9.62643L149.725 12.344L154.437 19.0788L153.8 23.4505L150.998 41.6463L145.522 70.1215L141.957 89.2625H143.994L146.414 86.7813L156.093 74.0206L172.266 53.698L179.398 45.6635L187.803 36.802L193.152 32.5484H203.34L210.726 43.6549L207.415 55.1159L196.972 68.3492L188.312 79.5739L175.896 96.2095L168.191 109.585L168.882 110.689L170.738 110.53L198.755 104.504L213.91 101.787L231.994 98.7149L240.144 102.496L241.036 106.395L237.852 114.311L218.495 119.037L195.826 123.645L162.07 131.592L161.696 131.893L162.137 132.547L177.36 133.925L183.855 134.279H199.774L229.447 136.524L237.215 141.605L241.8 147.867L241.036 152.711L229.065 158.737L213.019 154.956L175.45 145.977L162.587 142.787H160.805V143.85L171.502 154.366L191.242 172.089L215.82 195.011L217.094 200.682L213.91 205.172L210.599 204.699L188.949 188.394L180.544 181.069L161.696 165.118H160.422V166.772L164.752 173.152L187.803 207.771L188.949 218.405L187.294 221.832L181.308 223.959L174.813 222.777L161.187 203.754L147.305 182.486L136.098 163.345L134.745 164.2L128.075 235.42L125.019 239.082L117.887 241.8L111.902 237.31L108.718 229.984L111.902 215.452L115.722 196.547L118.779 181.541L121.58 162.873L123.291 156.636L123.14 156.219L121.773 156.449L107.699 175.752L86.304 204.699L69.3663 222.777L65.291 224.431L58.2867 220.768L58.9235 214.27L62.8713 208.48L86.304 178.705L100.44 160.155L109.551 149.507L109.462 147.967L108.959 147.924L46.6977 188.512L35.6182 189.93L30.7788 185.44L31.4156 178.115L33.7079 175.752L52.4285 162.873Z" fill="currentColor"/></svg>`,
    color: '#D97757',
    name: 'Claude Code',
  },
  copilot: {
    svg: `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M7.998 15.035c-4.562 0-7.873-2.914-7.998-3.749V9.338c.085-.628.677-1.686 1.588-2.065.013-.07.024-.143.036-.218.029-.183.06-.384.126-.612-.201-.508-.254-1.084-.254-1.656 0-.87.128-1.769.693-2.484.579-.733 1.494-1.124 2.724-1.261 1.206-.134 2.262.034 2.944.765.05.053.096.108.139.165.044-.057.094-.112.143-.165.682-.731 1.738-.899 2.944-.765 1.23.137 2.145.528 2.724 1.261.566.715.693 1.614.693 2.484 0 .572-.053 1.148-.254 1.656.066.228.098.429.126.612.012.076.024.148.037.218.924.385 1.522 1.471 1.591 2.095v1.872c0 .766-3.351 3.795-8.002 3.795Zm0-1.485c2.28 0 4.584-1.11 5.002-1.433V7.862l-.023-.116c-.49.21-1.075.291-1.727.291-1.146 0-2.059-.327-2.71-.991A3.222 3.222 0 0 1 8 6.303a3.24 3.24 0 0 1-.544.743c-.65.664-1.563.991-2.71.991-.652 0-1.236-.081-1.727-.291l-.023.116v4.255c.419.323 2.722 1.433 5.002 1.433ZM6.762 2.83c-.193-.206-.637-.413-1.682-.297-1.019.113-1.479.404-1.713.7-.247.312-.369.789-.369 1.554 0 .793.129 1.171.308 1.371.162.181.519.379 1.442.379.853 0 1.339-.235 1.638-.54.315-.322.527-.827.617-1.553.117-.935-.037-1.395-.241-1.614Zm4.155-.297c-1.044-.116-1.488.091-1.681.297-.204.219-.359.679-.242 1.614.091.726.303 1.231.618 1.553.299.305.784.54 1.638.54.922 0 1.28-.198 1.442-.379.179-.2.308-.578.308-1.371 0-.765-.123-1.242-.37-1.554-.233-.296-.693-.587-1.713-.7Z"/><path d="M6.25 9.037a.75.75 0 0 1 .75.75v1.501a.75.75 0 0 1-1.5 0V9.787a.75.75 0 0 1 .75-.75Zm4.25.75v1.501a.75.75 0 0 1-1.5 0V9.787a.75.75 0 0 1 1.5 0Z"/></svg>`,
    color: '#6E40C9',
    name: 'GitHub Copilot',
  },
};

function CliIcon({ cliType }: { cliType?: CliType }) {
  const type = cliType || 'claude';
  const meta = CLI_ICON_META[type];
  if (!meta) return null;
  return (
    <span
      title={meta.name}
      style={{ color: meta.color, display: 'inline-flex', alignItems: 'center', flexShrink: 0, opacity: 0.8 }}
      dangerouslySetInnerHTML={{ __html: meta.svg }}
    />
  );
}

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
    : s.status === 'attention' ? '#f59e0b' : s.status === 'done' ? '#3b82f6' : undefined;

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
