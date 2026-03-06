'use client';

import type { CharacterData } from '@/lib/types';
import { STATUS_COLORS } from '@/lib/constants';
import { ActionList } from './HoverCard';

interface PanelHeaderProps {
  name: string;
  color: string;
  onClose: () => void;
}

function PanelHeader({ name, color, onClose }: PanelHeaderProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        borderBottom: '1px solid var(--border-color)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            backgroundColor: color,
            display: 'inline-block',
          }}
        />
        <span style={{ fontSize: 14, fontWeight: 'bold' }}>{name}</span>
      </div>
      <button
        onClick={onClose}
        style={{
          width: 24,
          height: 24,
          borderRadius: 4,
          border: '1px solid var(--border-color)',
          background: 'var(--bg-tertiary)',
          color: 'var(--text-secondary)',
          fontSize: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        x
      </button>
    </div>
  );
}

interface SessionInfoProps {
  character: CharacterData;
}

function SessionInfo({ character }: SessionInfoProps) {
  return (
    <div style={{ padding: '12px 16px' }}>
      <div style={{ marginBottom: 8 }}>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
          Status
        </span>
        <div style={{ marginTop: 2 }}>
          <span
            style={{
              display: 'inline-block',
              padding: '2px 8px',
              borderRadius: 3,
              fontSize: 11,
              backgroundColor: STATUS_COLORS[character.status] || STATUS_COLORS.idle,
              color: '#fff',
              textTransform: 'uppercase',
            }}
          >
            {character.status}
          </span>
        </div>
      </div>
      {character.currentTool && (
        <div style={{ marginBottom: 8 }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            Current Tool
          </span>
          <div style={{ fontSize: 12, color: 'var(--accent)', marginTop: 2 }}>
            {character.currentTool}
          </div>
        </div>
      )}
      {character.isAgent && character.parentName && (
        <div style={{ marginBottom: 8 }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            Parent Session
          </span>
          <div style={{ fontSize: 12, marginTop: 2 }}>{character.parentName}</div>
        </div>
      )}
      {character.teamId && (
        <div style={{ marginBottom: 8 }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            Team
          </span>
          <div style={{ fontSize: 12, marginTop: 2 }}>{character.teamId}</div>
        </div>
      )}
    </div>
  );
}

interface SidePanelProps {
  character: CharacterData | null;
  onClose: () => void;
}

export default function SidePanel({ character, onClose }: SidePanelProps) {
  const isOpen = character !== null;

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          onClick={onClose}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.3)',
            zIndex: 44,
          }}
        />
      )}
      {/* Panel */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          width: 320,
          height: '100vh',
          background: 'var(--bg-secondary)',
          borderLeft: '1px solid var(--border-color)',
          zIndex: 45,
          transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.25s ease-in-out',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {character && (
          <>
            <PanelHeader name={character.name} color={character.color} onClose={onClose} />
            <SessionInfo character={character} />
            {character.recentActions.length > 0 && (
              <div style={{ padding: '0 16px', flex: 1, overflowY: 'auto' }}>
                <span
                  style={{
                    fontSize: 10,
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                    display: 'block',
                    marginBottom: 6,
                  }}
                >
                  Recent Actions
                </span>
                <ActionList actions={character.recentActions} max={10} />
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
