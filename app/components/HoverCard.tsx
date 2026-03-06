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
        minWidth: 160,
        maxWidth: 240,
      }}
    >
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
        <span style={{ fontSize: 12, fontWeight: 'bold' }}>{character.name}</span>
        <StatusBadge status={character.status} />
      </div>
      {character.currentTool && (
        <div style={{ fontSize: 10, color: 'var(--accent)', marginBottom: 4 }}>
          Using: {character.currentTool}
        </div>
      )}
      {character.recentActions.length > 0 && (
        <div style={{ marginTop: 4, borderTop: '1px solid var(--border-color)', paddingTop: 4 }}>
          <ActionList actions={character.recentActions} max={3} />
        </div>
      )}
    </div>
  );
}
