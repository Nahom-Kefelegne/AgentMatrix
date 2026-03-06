'use client';

import type { CharacterData } from '@/lib/types';
import { STATUS_COLORS } from '@/lib/constants';

function formatTimeAgo(timestamp?: number): string {
  if (!timestamp) return '';
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

interface SidePanelProps {
  character: CharacterData | null;
  onClose: () => void;
  isTaskTracker?: boolean;
  onSetTaskTracker?: (sessionId: string) => void;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 11,
      fontWeight: 600,
      color: '#9a9ab0',
      textTransform: 'uppercase',
      letterSpacing: 1,
      marginBottom: 6,
    }}>
      {children}
    </div>
  );
}

export default function SidePanel({ character, onClose, isTaskTracker, onSetTaskTracker }: SidePanelProps) {
  const isOpen = character !== null;

  return (
    <>
      {isOpen && (
        <div
          onClick={onClose}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.4)',
            zIndex: 44,
          }}
        />
      )}
      <div
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          width: 340,
          height: '100vh',
          background: '#151520',
          borderLeft: '1px solid #2a2a3e',
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
            {/* Header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px 20px',
              borderBottom: '1px solid #2a2a3e',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  backgroundColor: character.color,
                  display: 'inline-block',
                  border: '2px solid rgba(255,255,255,0.15)',
                }} />
                <span style={{ fontSize: 18, fontWeight: 700, color: '#eee' }}>
                  {character.name}
                </span>
              </div>
              <button
                onClick={onClose}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  border: '1px solid #3a3a4e',
                  background: '#1e1e30',
                  color: '#aaa',
                  fontSize: 14,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
              {/* Status */}
              <div style={{ marginBottom: 20 }}>
                <SectionLabel>Status</SectionLabel>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    display: 'inline-block',
                    padding: '4px 12px',
                    borderRadius: 4,
                    fontSize: 13,
                    fontWeight: 600,
                    backgroundColor: STATUS_COLORS[character.status] || STATUS_COLORS.idle,
                    color: '#fff',
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                  }}>
                    {character.status}
                  </span>
                  {character.lastActivity && (
                    <span style={{ fontSize: 13, color: '#888' }}>
                      {formatTimeAgo(character.lastActivity)}
                    </span>
                  )}
                </div>
              </div>

              {/* Current Tool */}
              {character.currentTool && (
                <div style={{ marginBottom: 20 }}>
                  <SectionLabel>Current Tool</SectionLabel>
                  <div style={{
                    fontSize: 15,
                    color: '#7aafff',
                    fontWeight: 600,
                  }}>
                    {character.currentTool}
                  </div>
                </div>
              )}

              {/* Last Action Summary */}
              {character.lastToolSummary && (
                <div style={{ marginBottom: 20 }}>
                  <SectionLabel>Working On</SectionLabel>
                  <div style={{
                    fontSize: 14,
                    color: '#c8c8d8',
                    padding: '8px 12px',
                    background: '#1a1a2a',
                    borderRadius: 6,
                    border: '1px solid #2a2a3e',
                    fontFamily: "'Courier New', monospace",
                  }}>
                    {character.lastToolSummary}
                  </div>
                </div>
              )}

              {/* Parent Session */}
              {character.isAgent && character.parentName && (
                <div style={{ marginBottom: 20 }}>
                  <SectionLabel>Parent Session</SectionLabel>
                  <div style={{ fontSize: 14, color: '#c8c8d8' }}>{character.parentName}</div>
                </div>
              )}

              {/* Team */}
              {character.teamId && (
                <div style={{ marginBottom: 20 }}>
                  <SectionLabel>Team</SectionLabel>
                  <div style={{ fontSize: 14, color: '#c8c8d8' }}>{character.teamId}</div>
                </div>
              )}

              {/* Recent Actions */}
              {character.recentActions.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <SectionLabel>Recent Actions</SectionLabel>
                  <div style={{
                    background: '#1a1a2a',
                    borderRadius: 6,
                    border: '1px solid #2a2a3e',
                    overflow: 'hidden',
                  }}>
                    {character.recentActions.slice(0, 8).map((action, i) => (
                      <div
                        key={i}
                        style={{
                          padding: '8px 12px',
                          fontSize: 13,
                          color: '#b0b0c0',
                          borderBottom: i < Math.min(character.recentActions.length, 8) - 1
                            ? '1px solid #222235'
                            : 'none',
                          fontFamily: "'Courier New', monospace",
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                        }}
                      >
                        <span style={{ color: '#666', fontSize: 11 }}>{'>'}</span>
                        <span>{action.summary || action.toolName}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Task Tracker Button */}
            {onSetTaskTracker && (
              <div style={{ padding: '16px 20px', borderTop: '1px solid #2a2a3e' }}>
                <button
                  onClick={() => onSetTaskTracker(character.id)}
                  style={{
                    width: '100%',
                    padding: '10px 16px',
                    borderRadius: 6,
                    border: isTaskTracker ? '1px solid #4a9eff' : '1px solid #3a3a4e',
                    background: isTaskTracker ? '#1a3a6a' : '#1e1e30',
                    color: isTaskTracker ? '#7aafff' : '#aaa',
                    fontSize: 14,
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    cursor: 'pointer',
                  }}
                >
                  {isTaskTracker ? '✓ Task Tracker' : 'Set as Task Tracker'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
