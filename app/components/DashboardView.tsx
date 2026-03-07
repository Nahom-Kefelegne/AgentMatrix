'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { SessionData, Action } from '@/lib/types';

const STATUS_COLORS: Record<string, string> = {
  idle: '#888888',
  working: '#51cf66',
  meeting: '#4a9eff',
};

const STATUS_GRADIENTS: Record<string, string> = {
  idle: 'linear-gradient(135deg, #888888, #666666)',
  working: 'linear-gradient(135deg, #51cf66, #2b9e3e)',
  meeting: 'linear-gradient(135deg, #4a9eff, #2a6fd4)',
};

const STATUS_LABELS: Record<string, string> = {
  working: 'Working',
  idle: 'Idle',
  meeting: 'In Meeting',
};

function formatTimeAgo(timestamp: number): string {
  const diff = Math.floor((Date.now() - timestamp) / 1000);
  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function truncatePath(path: string, maxLen = 45): string {
  if (path.length <= maxLen) return path;
  const parts = path.split('/');
  if (parts.length <= 3) return '...' + path.slice(-maxLen);
  return '.../' + parts.slice(-3).join('/');
}

interface DashboardViewProps {
  sessions: Map<string, SessionData>;
  onSelectSession: (sessionId: string) => void;
}

export default function DashboardView({ sessions, onSelectSession }: DashboardViewProps) {
  const sessionList = Array.from(sessions.values());
  const [filter, setFilter] = useState<'all' | 'working' | 'idle' | 'meeting'>('all');
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 5000);
    return () => clearInterval(interval);
  }, []);

  const filtered = filter === 'all' ? sessionList : sessionList.filter(s => s.status === filter);
  const workingCount = sessionList.filter(s => s.status === 'working').length;
  const idleCount = sessionList.filter(s => s.status === 'idle').length;
  const meetingCount = sessionList.filter(s => s.status === 'meeting').length;

  return (
    <div style={{
      marginTop: 'var(--header-height)',
      height: 'calc(100vh - var(--header-height))',
      overflowY: 'auto',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
    }}>
      {/* Stats bar */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '18px 20px 0', width: '100%', maxWidth: 1200,
        }}
      >
        <StatPill label="All" count={sessionList.length} active={filter === 'all'} color="#aaa" onClick={() => setFilter('all')} />
        {workingCount > 0 && <StatPill label="Working" count={workingCount} active={filter === 'working'} color="#51cf66" onClick={() => setFilter('working')} />}
        {idleCount > 0 && <StatPill label="Idle" count={idleCount} active={filter === 'idle'} color="#888" onClick={() => setFilter('idle')} />}
        {meetingCount > 0 && <StatPill label="Meeting" count={meetingCount} active={filter === 'meeting'} color="#4a9eff" onClick={() => setFilter('meeting')} />}
      </motion.div>

      {/* Cards */}
      {filtered.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 12,
          }}
        >
          <div style={{ fontSize: 48, opacity: 0.15 }}>&#9673;</div>
          <div style={{ fontSize: 18, color: '#888' }}>
            {sessionList.length === 0 ? 'No sessions yet' : 'No sessions match filter'}
          </div>
          <div style={{ fontSize: 14, color: '#555' }}>
            Click <strong style={{ color: '#4a9eff' }}>+ New</strong> to start a session
          </div>
        </motion.div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(370px, 1fr))',
          gap: 16, padding: '16px 20px 30px',
          width: '100%', maxWidth: 1200,
        }}>
          <AnimatePresence mode="popLayout">
            {filtered.map((session, i) => (
              <SessionCard
                key={session.id}
                session={session}
                index={i}
                onClick={() => onSelectSession(session.id)}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      <style>{`
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        @keyframes pulseGlow {
          0%, 100% { box-shadow: 0 0 4px currentColor; }
          50% { box-shadow: 0 0 12px currentColor; }
        }
      `}</style>
    </div>
  );
}

function StatPill({ label, count, active, color, onClick }: {
  label: string; count: number; active: boolean; color: string; onClick: () => void;
}) {
  return (
    <motion.button
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      style={{
        padding: '7px 16px', borderRadius: 20,
        border: active ? `1px solid ${color}` : '1px solid #2a2a3a',
        background: active ? `${color}15` : 'transparent',
        color: active ? color : '#999',
        fontSize: 15, fontWeight: 600,
        cursor: 'pointer', fontFamily: 'inherit',
        display: 'flex', alignItems: 'center', gap: 6,
      }}
    >
      {label}
      <span style={{
        fontSize: 13, fontWeight: 700,
        background: active ? `${color}25` : '#222238',
        padding: '1px 7px', borderRadius: 10,
        color: active ? color : '#666',
      }}>
        {count}
      </span>
    </motion.button>
  );
}

function SessionCard({ session, index, onClick }: {
  session: SessionData; index: number; onClick: () => void;
}) {
  const statusColor = STATUS_COLORS[session.status] || STATUS_COLORS.idle;
  const statusGradient = STATUS_GRADIENTS[session.status] || STATUS_GRADIENTS.idle;
  const statusLabel = STATUS_LABELS[session.status] || session.status;
  const isWorking = session.status === 'working';
  const recentActions = session.recentActions.slice(0, 3);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95, y: -10 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      whileHover={{ y: -4, transition: { duration: 0.15 } }}
      onClick={onClick}
      style={{
        background: 'rgba(22, 22, 37, 0.8)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 14,
        cursor: 'pointer',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Top gradient accent */}
      <div style={{
        height: 3,
        background: statusGradient,
        opacity: isWorking ? 1 : 0.5,
      }} />

      {/* Shimmer for working */}
      {isWorking && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 3,
          background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.3) 50%, transparent 100%)',
          backgroundSize: '200% 100%',
          animation: 'shimmer 2s ease-in-out infinite',
        }} />
      )}

      <div style={{ padding: '16px 20px 18px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 19, fontWeight: 700, color: '#f0f0f0',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {session.name}
            </div>
            {session.cwd && (
              <div style={{
                fontSize: 13, color: '#666', marginTop: 3,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                fontFamily: "'Courier New', monospace",
              }}>
                {truncatePath(session.cwd)}
              </div>
            )}
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '4px 12px', borderRadius: 8,
            background: `${statusColor}12`,
            border: `1px solid ${statusColor}25`,
            flexShrink: 0, marginLeft: 12,
          }}>
            <div style={{
              width: 7, height: 7, borderRadius: '50%',
              backgroundColor: statusColor, color: statusColor,
              animation: isWorking ? 'pulseGlow 1.5s ease-in-out infinite' : 'none',
            }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: statusColor }}>
              {statusLabel}
            </span>
          </div>
        </div>

        {/* Tool summary */}
        {isWorking && session.lastToolSummary && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            style={{
              fontSize: 14, color: '#a8d4ff',
              padding: '8px 12px', marginTop: 4, marginBottom: 4,
              background: 'rgba(20, 40, 70, 0.5)',
              borderRadius: 8, border: '1px solid rgba(74, 158, 255, 0.15)',
              fontFamily: "'Courier New', monospace",
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}
          >
            {session.lastToolSummary}
          </motion.div>
        )}

        {/* Agents */}
        {session.agents && session.agents.length > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            marginTop: 8, padding: '6px 12px',
            background: 'rgba(26, 26, 53, 0.6)',
            borderRadius: 8, border: '1px solid rgba(255,255,255,0.04)',
          }}>
            <span style={{ fontSize: 14, color: '#9a9aff', fontWeight: 600 }}>
              {session.agents.length} agent{session.agents.length !== 1 ? 's' : ''}
            </span>
            <span style={{ fontSize: 13, color: '#777', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {session.agents.map(a => a.name).join(', ')}
            </span>
          </div>
        )}

        {/* Recent actions */}
        {recentActions.length > 0 && (
          <div style={{
            borderTop: '1px solid rgba(255,255,255,0.04)',
            paddingTop: 10, marginTop: 12,
          }}>
            {recentActions.map((action, i) => (
              <div key={i} style={{
                fontSize: 13, color: '#aaa', padding: '3px 0',
                display: 'flex', alignItems: 'center', gap: 6,
                opacity: 1 - (i * 0.2),
              }}>
                <span style={{ color: '#555', fontSize: 10 }}>&#9656;</span>
                <span style={{
                  overflow: 'hidden', textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap', flex: 1, color: '#bbb',
                }}>
                  {action.summary || action.toolName}
                </span>
                <span style={{ color: '#555', fontSize: 12, flexShrink: 0 }}>
                  {formatTimeAgo(action.timestamp)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Last activity */}
        {session.lastActivity && !isWorking && (
          <div style={{
            fontSize: 12, color: '#555', textAlign: 'right', marginTop: 10,
          }}>
            Last active {formatTimeAgo(session.lastActivity)}
          </div>
        )}
      </div>
    </motion.div>
  );
}
