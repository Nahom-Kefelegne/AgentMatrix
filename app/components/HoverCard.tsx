'use client';

import { forwardRef } from 'react';
import type { CharacterData, Action } from '@/lib/types';
import { STATUS_COLORS } from '@/lib/constants';

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 4,
        fontSize: 12,
        fontWeight: 600,
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
            fontSize: 13,
            color: '#b0b0c0',
            padding: '2px 0',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: 280,
          }}
        >
          <span style={{ color: '#7aafff' }}>{a.toolName}</span>{' '}
          {a.summary}
        </li>
      ))}
    </ul>
  );
}

interface HoverCardProps {
  character: CharacterData | null;
  x?: number;
  y?: number;
}

const HoverCard = forwardRef<HTMLDivElement, HoverCardProps>(function HoverCard(
  { character, x, y },
  ref,
) {
  if (!character) return null;

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left: x === undefined ? 0 : x + 16,
        top: y === undefined ? 0 : y + 16,
        background: '#151520',
        border: '1px solid #2a2a3e',
        borderRadius: 8,
        padding: '10px 14px',
        zIndex: 40,
        pointerEvents: 'none',
        minWidth: 220,
        maxWidth: 320,
        willChange: x === undefined ? 'transform' : undefined,
      }}
    >
      {/* Name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            backgroundColor: character.color,
            display: 'inline-block',
            border: '2px solid rgba(255,255,255,0.15)',
          }}
        />
        <span style={{ fontSize: 15, fontWeight: 700, color: '#eee' }}>
          {character.name}
        </span>
      </div>

      {/* Status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <StatusBadge status={character.status} />
        {character.lastActivity && (
          <span style={{ fontSize: 12, color: '#888' }}>
            {formatTimeAgo(character.lastActivity)}
          </span>
        )}
      </div>

      {/* Current tool */}
      {character.currentTool && (
        <div style={{ fontSize: 14, color: '#7aafff', marginBottom: 4, fontWeight: 600 }}>
          Using: {character.currentTool}
        </div>
      )}

      {/* Tool summary */}
      {character.lastToolSummary && (
        <div
          style={{
            fontSize: 13,
            color: '#b0b0c0',
            marginBottom: 6,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: 290,
            fontFamily: "'Courier New', monospace",
          }}
        >
          {character.lastToolSummary}
        </div>
      )}

      {/* Recent actions */}
      {character.recentActions.length > 0 && (
        <div style={{ marginTop: 6, borderTop: '1px solid #2a2a3e', paddingTop: 6 }}>
          <ActionList actions={character.recentActions} max={2} />
        </div>
      )}
    </div>
  );
});

export default HoverCard;
