'use client';

import { useState, useEffect } from 'react';
import type { SessionData, Action } from '@/lib/types';

const STATUS_COLORS: Record<string, string> = {
  idle: '#888888',
  working: '#51cf66',
  meeting: '#4a9eff',
};

const STATUS_LABELS: Record<string, string> = {
  working: 'Working',
  idle: 'Idle',
  meeting: 'In Meeting',
};

const STATUS_ICONS: Record<string, string> = {
  working: '&#9881;',  // gear
  idle: '&#9679;',     // circle
  meeting: '&#9734;',  // star
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

  // Live-update relative timestamps every 5s
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
      {/* Status summary bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '16px 20px 0',
        width: '100%',
        maxWidth: 1200,
      }}>
        <FilterPill
          label={`All ${sessionList.length}`}
          active={filter === 'all'}
          color="#aaa"
          onClick={() => setFilter('all')}
        />
        {workingCount > 0 && (
          <FilterPill
            label={`Working ${workingCount}`}
            active={filter === 'working'}
            color="#51cf66"
            onClick={() => setFilter('working')}
          />
        )}
        {idleCount > 0 && (
          <FilterPill
            label={`Idle ${idleCount}`}
            active={filter === 'idle'}
            color="#888"
            onClick={() => setFilter('idle')}
          />
        )}
        {meetingCount > 0 && (
          <FilterPill
            label={`Meeting ${meetingCount}`}
            active={filter === 'meeting'}
            color="#4a9eff"
            onClick={() => setFilter('meeting')}
          />
        )}
      </div>

      {/* Cards grid */}
      {filtered.length === 0 ? (
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#777',
          fontSize: 18,
          gap: 8,
        }}>
          <span style={{ fontSize: 36, opacity: 0.4 }}>
            {sessionList.length === 0 ? '...' : '(none)'}
          </span>
          <span>{sessionList.length === 0 ? 'No active sessions' : 'No sessions match filter'}</span>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
          gap: 14,
          padding: '14px 20px 24px',
          width: '100%',
          maxWidth: 1200,
        }}>
          {filtered.map(session => (
            <SessionCard
              key={session.id}
              session={session}
              onClick={() => onSelectSession(session.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterPill({ label, active, color, onClick }: {
  label: string; active: boolean; color: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 16px',
        borderRadius: 20,
        border: active ? `1px solid ${color}` : '1px solid #2a2a3a',
        background: active ? `${color}18` : 'transparent',
        color: active ? color : '#999',
        fontSize: 15,
        fontWeight: 600,
        cursor: 'pointer',
        fontFamily: 'inherit',
        transition: 'all 0.15s',
      }}
    >
      {label}
    </button>
  );
}

function RecentActionsCollapsible({ actions }: { actions: Action[] }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{
      borderTop: '1px solid #222238',
      paddingTop: 8,
      marginTop: 10,
    }}>
      <button
        onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '2px 0', width: '100%', fontFamily: 'inherit',
        }}
      >
        <span style={{
          color: '#888', fontSize: 11, flexShrink: 0,
          transform: expanded ? 'rotate(90deg)' : 'none',
          transition: 'transform 0.15s',
          display: 'inline-block',
        }}>
          &#9656;
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#999' }}>
          Recent Actions ({actions.length})
        </span>
      </button>
      {expanded && (
        <div style={{ marginTop: 6 }}>
          {actions.map((action, i) => (
            <div key={i} style={{
              fontSize: 14, color: '#bbb', padding: '5px 0 5px 18px',
              borderBottom: i < actions.length - 1 ? '1px solid #1e1e30' : 'none',
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 8,
              }}>
                <span style={{ fontWeight: 600, color: '#8ab4e0', fontSize: 13, flexShrink: 0 }}>
                  {action.toolName}
                </span>
                <span style={{ color: '#777', fontSize: 13, flexShrink: 0 }}>
                  {formatTimeAgo(action.timestamp)}
                </span>
              </div>
              <div style={{
                fontSize: 13, color: '#aaa', marginTop: 2,
                wordBreak: 'break-word', lineHeight: 1.4,
              }}>
                {action.summary || action.toolName}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SessionCard({ session, onClick }: { session: SessionData; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  const statusColor = STATUS_COLORS[session.status] || STATUS_COLORS.idle;
  const statusLabel = STATUS_LABELS[session.status] || session.status;
  const recentActions = session.recentActions.slice(0, 3);
  const isWorking = session.status === 'working';

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? '#1e1e36' : '#161625',
        border: `1px solid ${hovered ? '#3a3a5a' : '#252538'}`,
        borderRadius: 12,
        padding: 0,
        cursor: 'pointer',
        position: 'relative',
        transition: 'all 0.15s ease',
        transform: hovered ? 'translateY(-2px)' : 'none',
        boxShadow: hovered ? '0 4px 20px rgba(0,0,0,0.3)' : '0 1px 4px rgba(0,0,0,0.15)',
        overflow: 'hidden',
      }}
    >
      {/* Status accent bar */}
      <div style={{
        height: 3,
        background: isWorking
          ? `linear-gradient(90deg, ${statusColor}, ${statusColor}88)`
          : statusColor,
        opacity: isWorking ? 1 : 0.6,
      }} />

      <div style={{ padding: '16px 20px 18px' }}>
        {/* Top row: name + status */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 19,
              fontWeight: 700,
              color: '#f0f0f0',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {session.name}
            </div>
            {session.cwd && (
              <div style={{
                fontSize: 14,
                color: '#888',
                marginTop: 3,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                fontFamily: "'Courier New', monospace",
              }}>
                {truncatePath(session.cwd)}
              </div>
            )}
          </div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '3px 10px',
            borderRadius: 6,
            background: `${statusColor}15`,
            border: `1px solid ${statusColor}30`,
            flexShrink: 0,
            marginLeft: 10,
          }}>
            <span style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              backgroundColor: statusColor,
              display: 'inline-block',
              boxShadow: isWorking ? `0 0 6px ${statusColor}` : 'none',
            }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: statusColor }}>
              {statusLabel}
            </span>
          </div>
        </div>

        {/* Current tool summary */}
        {isWorking && session.lastToolSummary && (
          <div style={{
            fontSize: 15,
            color: '#a8d4ff',
            padding: '8px 12px',
            background: '#1a2540',
            borderRadius: 6,
            marginTop: 8,
            marginBottom: 4,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            fontFamily: "'Courier New', monospace",
          }}>
            {session.lastToolSummary}
          </div>
        )}

        {/* Agent badge */}
        {session.agents && session.agents.length > 0 && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginTop: 8,
            padding: '5px 10px',
            background: '#1a1a35',
            borderRadius: 6,
            border: '1px solid #2a2a4a',
          }}>
            <span style={{ fontSize: 14, color: '#9a9aff', fontWeight: 600 }}>
              {session.agents.length} agent{session.agents.length !== 1 ? 's' : ''}
            </span>
            <span style={{ fontSize: 14, color: '#888' }}>
              {session.agents.map(a => a.name).join(', ')}
            </span>
          </div>
        )}

        {/* Recent actions */}
        {recentActions.length > 0 && (
          <RecentActionsCollapsible actions={recentActions} />
        )}

        {/* Last activity */}
        {session.lastActivity && !isWorking && (
          <div style={{
            fontSize: 13,
            color: '#777',
            textAlign: 'right',
            marginTop: 8,
          }}>
            Last active {formatTimeAgo(session.lastActivity)}
          </div>
        )}
      </div>
    </div>
  );
}
