'use client';

import type { SessionData } from '@/lib/types';
import { STATUS_COLORS } from '@/lib/constants';

function formatTimeAgo(timestamp: number): string {
  const diff = Math.floor((Date.now() - timestamp) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function truncatePath(path: string, maxLen = 40): string {
  if (path.length <= maxLen) return path;
  const parts = path.split('/');
  if (parts.length <= 3) return '...' + path.slice(-maxLen);
  return '.../' + parts.slice(-3).join('/');
}

const STATUS_LABELS: Record<string, string> = {
  working: 'Working',
  idle: 'Idle',
  meeting: 'In Meeting',
};

interface DashboardViewProps {
  sessions: Map<string, SessionData>;
  onSelectSession: (sessionId: string) => void;
}

export default function DashboardView({ sessions, onSelectSession }: DashboardViewProps) {
  const sessionList = Array.from(sessions.values());

  if (sessionList.length === 0) {
    return (
      <div
        style={{
          marginTop: 'var(--header-height)',
          height: 'calc(100vh - var(--header-height))',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#555',
          fontSize: 16,
        }}
      >
        No active sessions
      </div>
    );
  }

  return (
    <div
      style={{
        marginTop: 'var(--header-height)',
        height: 'calc(100vh - var(--header-height))',
        overflowY: 'auto',
        padding: 20,
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
          gap: 16,
        }}
      >
        {sessionList.map((session) => (
          <SessionCard
            key={session.id}
            session={session}
            onClick={() => onSelectSession(session.id)}
          />
        ))}
      </div>
    </div>
  );
}

function SessionCard({ session, onClick }: { session: SessionData; onClick: () => void }) {
  const borderColor = STATUS_COLORS[session.status] || STATUS_COLORS.idle;
  const statusLabel = STATUS_LABELS[session.status] || session.status;
  const recentActions = session.recentActions.slice(0, 3);

  return (
    <div
      onClick={onClick}
      style={{
        background: '#1a1a2e',
        border: '1px solid #2a2a3a',
        borderLeft: `4px solid ${borderColor}`,
        borderRadius: 10,
        padding: '16px 18px',
        cursor: 'pointer',
        position: 'relative',
        transition: 'background 0.15s, border-color 0.15s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = '#222240';
        e.currentTarget.style.borderColor = '#3a3a5a';
        e.currentTarget.style.borderLeftColor = borderColor;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = '#1a1a2e';
        e.currentTarget.style.borderColor = '#2a2a3a';
        e.currentTarget.style.borderLeftColor = borderColor;
      }}
    >
      {/* Session name */}
      <div style={{ fontSize: 18, fontWeight: 700, color: '#eee', marginBottom: 4 }}>
        {session.name}
      </div>

      {/* Working directory */}
      {session.cwd && (
        <div
          style={{
            fontSize: 13,
            color: '#888',
            marginBottom: 8,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {truncatePath(session.cwd)}
        </div>
      )}

      {/* Status row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: borderColor,
            display: 'inline-block',
          }}
        />
        <span style={{ fontSize: 14, color: '#ccc' }}>{statusLabel}</span>

        {/* Agent count badge */}
        {session.agents && session.agents.length > 0 && (
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 12,
              fontWeight: 600,
              padding: '2px 8px',
              borderRadius: 10,
              backgroundColor: '#2a2a4a',
              color: '#8a8aff',
            }}
          >
            {session.agents.length} agent{session.agents.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Current tool + summary */}
      {session.status === 'working' && session.currentTool && (
        <div
          style={{
            fontSize: 13,
            color: '#4a9eff',
            marginBottom: 8,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {session.lastToolSummary
            ? `${session.currentTool} ${session.lastToolSummary}`
            : session.currentTool}
        </div>
      )}

      {/* Recent actions */}
      {recentActions.length > 0 && (
        <div style={{ borderTop: '1px solid #2a2a3a', paddingTop: 8, marginTop: 4 }}>
          {recentActions.map((action, i) => (
            <div
              key={i}
              style={{
                fontSize: 12,
                color: '#999',
                padding: '2px 0',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span style={{ color: '#7aafff', flexShrink: 0 }}>{action.toolName}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {action.summary}
              </span>
              <span style={{ marginLeft: 'auto', flexShrink: 0, color: '#666', fontSize: 11 }}>
                {formatTimeAgo(action.timestamp)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Last activity timestamp */}
      {session.lastActivity && (
        <div
          style={{
            position: 'absolute',
            bottom: 10,
            right: 14,
            fontSize: 11,
            color: '#555',
          }}
        >
          {formatTimeAgo(session.lastActivity)}
        </div>
      )}
    </div>
  );
}
