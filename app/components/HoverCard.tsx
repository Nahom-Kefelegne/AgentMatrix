'use client';

import type { CharacterData, Action } from '@/lib/types';
import { STATUS_COLORS } from '@/lib/constants';

interface StatusBadgeProps {
  status: string;
}

function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 6px',
        borderRadius: 3,
        fontSize: 10,
        backgroundColor: STATUS_COLORS[status] || STATUS_COLORS.idle,
        color: '#fff',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
      }}
    >
      {status}
    </span>
  );
}

function StatusDot({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    working: '#51cf66',
    idle: '#888888',
    meeting: '#4a9eff',
  };
  return (
    <span
      style={{
        display: 'inline-block',
        width: 6,
        height: 6,
        borderRadius: '50%',
        backgroundColor: colorMap[status] || '#888888',
      }}
    />
  );
}

function formatTimeAgo(timestamp: number): string {
  const diff = Math.floor((Date.now() - timestamp) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

interface ActionListProps {
  actions: Action[];
  max?: number;
}

export function ActionList({ actions, max = 3 }: ActionListProps) {
  const visible = actions.slice(0, max);
  if (visible.length === 0) return null;

  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {visible.map((a, i) => (
        <li
          key={i}
          style={{
            fontSize: 10,
            color: 'var(--text-secondary)',
            padding: '1px 0',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: 200,
          }}
        >
          <span style={{ color: 'var(--accent)' }}>{a.toolName}</span>{' '}
          {a.summary}
        </li>
      ))}
    </ul>
  );
}

interface HoverCardProps {
  character: CharacterData | null;
  x: number;
  y: number;
}

export default function HoverCard({ character, x, y }: HoverCardProps) {
  if (!character) return null;

  return (
    <div
      style={{
        position: 'fixed',
        left: x + 16,
        top: y + 16,
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-color)',
        borderRadius: 6,
        padding: '8px 12px',
        zIndex: 40,
        pointerEvents: 'none',
        minWidth: 180,
        maxWidth: 260,
      }}
    >
      {/* Name row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: character.color,
            display: 'inline-block',
          }}
        />
        <span style={{ fontSize: 12, fontWeight: 'bold', color: 'var(--text-primary)' }}>
          {character.name}
        </span>
      </div>

      {/* Status row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <StatusDot status={character.status} />
        <StatusBadge status={character.status} />
        {character.lastActivity && (
          <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>
            {formatTimeAgo(character.lastActivity)}
          </span>
        )}
      </div>

      {/* Current tool */}
      {character.currentTool && (
        <div style={{ fontSize: 10, color: 'var(--accent)', marginBottom: 2 }}>
          Using: {character.currentTool}
        </div>
      )}

      {/* Tool summary */}
      {character.lastToolSummary && (
        <div
          style={{
            fontSize: 10,
            color: 'var(--text-secondary)',
            marginBottom: 4,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: 230,
          }}
        >
          {character.lastToolSummary}
        </div>
      )}

      {/* Recent actions */}
      {character.recentActions.length > 0 && (
        <div style={{ marginTop: 4, borderTop: '1px solid var(--border-color)', paddingTop: 4 }}>
          <ActionList actions={character.recentActions} max={2} />
        </div>
      )}
    </div>
  );
}
