'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { SessionData } from '@/lib/types';
import { useSocketContext } from './SocketProvider';
import ContextBar from './ContextBar';
import { useSessionContext } from '@/lib/hooks/useSessionContext';

const STATUS: Record<string, { color: string; label: string }> = {
  idle: { color: '#888', label: 'Idle' },
  working: { color: '#51cf66', label: 'Working' },
  meeting: { color: '#4a9eff', label: 'In Meeting' },
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
  onSelectSession: (id: string) => void;
}

export default function DashboardView({ sessions, onSelectSession }: Props) {
  const { socketRef, connected } = useSocketContext();
  const contextMap = useSessionContext(socketRef, connected);
  const all = Array.from(sessions.values());
  const [filter, setFilter] = useState('all');
  const [, tick] = useState(0);
  useEffect(() => { const i = setInterval(() => tick(t => t + 1), 5000); return () => clearInterval(i); }, []);

  const list = filter === 'all' ? all : all.filter(s => s.status === filter);
  const counts: Record<string, number> = {
    all: all.length,
    working: all.filter(s => s.status === 'working').length,
    idle: all.filter(s => s.status === 'idle').length,
    meeting: all.filter(s => s.status === 'meeting').length,
  };

  const filters = [
    { key: 'all', label: 'All Sessions' },
    { key: 'working', label: 'Working' },
    { key: 'idle', label: 'Idle' },
    { key: 'meeting', label: 'Meeting' },
  ].filter(f => f.key === 'all' || counts[f.key] > 0);

  return (
    <div
      style={{ marginTop: 'var(--header-height)', height: 'calc(100vh - var(--header-height))', background: '#08080f' }}
      className="overflow-y-auto"
    >
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 40px 48px' }}>
        {/* Filter bar */}
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} style={{ display: 'flex', gap: 10, marginBottom: 28 }}>
          {filters.map(f => {
            const active = filter === f.key;
            const meta = STATUS[f.key];
            const c = meta?.color || '#4a9eff';
            return (
              <motion.button key={f.key} whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                onClick={() => setFilter(f.key)}
                style={{
                  padding: '8px 20px', borderRadius: 24, fontSize: 14, fontWeight: 600,
                  fontFamily: 'inherit', cursor: 'pointer',
                  border: active ? `1.5px solid ${c}40` : '1.5px solid #1a1a28',
                  background: active ? `${c}10` : '#0e0e18',
                  color: active ? c : '#666', transition: 'all 0.15s',
                }}
              >
                {f.label}
                <span style={{
                  marginLeft: 8, fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 12,
                  background: active ? `${c}18` : '#151520', color: active ? c : '#444',
                }}>{counts[f.key]}</span>
              </motion.button>
            );
          })}
        </motion.div>

        {/* Cards */}
        {list.length === 0 ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '120px 0', gap: 16 }}>
            <div style={{ fontSize: 56, opacity: 0.08 }}>&#11044;</div>
            <div style={{ fontSize: 18, color: '#666' }}>{all.length === 0 ? 'No sessions yet' : 'No sessions match filter'}</div>
            <div style={{ fontSize: 14, color: '#444' }}>Click <strong style={{ color: '#4a9eff' }}>+ New</strong> to launch a session</div>
          </motion.div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(480px, 1fr))', gap: 20 }}>
            <AnimatePresence mode="popLayout">
              {list.map((s, i) => <SessionCard key={s.id} s={s} i={i} contextUsage={contextMap[s.id] ?? null} onClick={() => onSelectSession(s.id)} />)}
            </AnimatePresence>
          </div>
        )}
      </div>

      <style>{`
        @keyframes cardShimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
        @keyframes statusPulse { 0%,100%{opacity:.4;transform:scale(.8)} 50%{opacity:1;transform:scale(1.25)} }
      `}</style>
    </div>
  );
}

function SessionCard({ s, i, contextUsage, onClick }: { s: SessionData; i: number; contextUsage: number | null; onClick: () => void }) {
  const meta = STATUS[s.status] || STATUS.idle;
  const working = s.status === 'working';
  const actions = s.recentActions.slice(0, 4);

  return (
    <motion.div layout
      initial={{ opacity: 0, y: 24, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.35, delay: i * 0.05, type: 'spring', stiffness: 240, damping: 22 }}
      whileHover={{ y: -5, transition: { duration: 0.12 } }}
      onClick={onClick}
      style={{
        cursor: 'pointer', borderRadius: 16, overflow: 'hidden', background: '#111120',
        border: '1px solid #1e1e30', position: 'relative', transition: 'border-color 0.15s',
      }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = '#2a2a45')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = '#1e1e30')}
    >
      {/* Accent bar */}
      <div style={{ height: 3, background: `linear-gradient(90deg, ${meta.color}, ${meta.color}66)`, opacity: working ? 1 : 0.3 }} />
      {working && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 3,
          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,.4), transparent)',
          backgroundSize: '200% 100%', animation: 'cardShimmer 2s ease-in-out infinite',
        }} />
      )}

      <div style={{ padding: '20px 24px 22px' }}>
        {/* Name + Status */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#eee', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {s.name}
            </div>
            {s.cwd && (
              <div style={{ fontSize: 13, color: '#555', marginTop: 4, fontFamily: "'Courier New', monospace", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {s.cwd}
              </div>
            )}
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 7, padding: '5px 14px', borderRadius: 10,
            background: `${meta.color}0c`, border: `1px solid ${meta.color}20`, flexShrink: 0,
          }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%', backgroundColor: meta.color,
              animation: working ? 'statusPulse 1.5s ease-in-out infinite' : 'none',
            }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: meta.color }}>{meta.label}</span>
          </div>
        </div>

        {/* Context bar */}
        {contextUsage !== null && (
          <div style={{ marginBottom: 14 }}>
            <ContextBar usage={contextUsage} compact />
          </div>
        )}

        {/* Stats */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
          <StatChip label="Session ID" value={s.id.slice(0, 8) + '...'} />
          {s.lastActivity && <StatChip label="Last Active" value={ago(s.lastActivity)} />}
          {s.agents && s.agents.length > 0 && <StatChip label="Agents" value={`${s.agents.length} active`} accent />}
        </div>

        {/* Tool summary */}
        {working && s.lastToolSummary && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
            style={{
              padding: '10px 14px', borderRadius: 10, marginBottom: 14,
              background: 'rgba(18, 35, 65, 0.5)', border: '1px solid rgba(74, 158, 255, 0.12)',
            }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#5a8abf', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
              Currently Working On
            </div>
            <div style={{ fontSize: 14, color: '#a0ccff', fontFamily: "'Courier New', monospace", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {s.lastToolSummary}
            </div>
          </motion.div>
        )}

        {/* Actions */}
        {actions.length > 0 && (
          <div style={{ borderTop: '1px solid #1a1a28', paddingTop: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
              Recent Activity
            </div>
            {actions.map((a, j) => (
              <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 13, opacity: 1 - j * 0.18 }}>
                <span style={{ color: '#333', fontSize: 10 }}>&#9656;</span>
                <span style={{ flex: 1, color: '#aaa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {a.summary || a.toolName}
                </span>
                <span style={{ color: '#444', fontSize: 12, flexShrink: 0 }}>{ago(a.timestamp)}</span>
              </div>
            ))}
          </div>
        )}

        {s.lastActivity && !working && (
          <div style={{ fontSize: 12, color: '#555', textAlign: 'right', marginTop: 10 }}>
            Last active {ago(s.lastActivity)}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function StatChip({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{
      padding: '6px 12px', borderRadius: 8, flex: 1,
      background: accent ? 'rgba(74, 74, 255, 0.06)' : '#0c0c16',
      border: `1px solid ${accent ? '#2a2a5a' : '#161625'}`,
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: 0.8 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: accent ? '#9a9aff' : '#bbb', marginTop: 2 }}>{value}</div>
    </div>
  );
}
