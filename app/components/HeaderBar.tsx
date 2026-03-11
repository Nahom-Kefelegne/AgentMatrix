'use client';

import { useState } from 'react';
import DropdownMenu from './DropdownMenu';

interface HeaderBarProps {
  connected: boolean;
  sessionCount: number;
  onSettingsClick: () => void;
  onSetupClick: () => void;
  onTasksClick: () => void;
  onResumeClick: () => void;
  onSessionsClick: () => void;
  onNewSessionClick: () => void;
  viewMode: 'office' | 'dashboard' | 'editor';
  onViewChange: (mode: 'office' | 'dashboard' | 'editor') => void;
}

function HeaderButton({ onClick, label, title, badge }: {
  onClick: () => void; label: string; title: string; badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        padding: '8px 16px',
        borderRadius: 6,
        border: '1px solid #3a3a4e',
        background: '#1e1e30',
        color: '#c8c8d8',
        fontSize: 16,
        fontWeight: 600,
        fontFamily: 'inherit',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        cursor: 'pointer',
        position: 'relative',
      }}
    >
      {label}
      {badge !== undefined && badge > 0 && (
        <span style={{
          background: '#4a9eff', color: '#fff', fontSize: 11, fontWeight: 700,
          borderRadius: 10, padding: '1px 6px', minWidth: 18, textAlign: 'center',
        }}>
          {badge}
        </span>
      )}
    </button>
  );
}

export default function HeaderBar({
  connected, sessionCount, onSettingsClick, onSetupClick, onTasksClick, onResumeClick, onSessionsClick,
  onNewSessionClick, viewMode, onViewChange,
}: HeaderBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0,
        height: 'var(--header-height)',
        background: 'rgba(10, 10, 20, 0.9)',
        backdropFilter: 'blur(8px)',
        borderBottom: '1px solid #2a2a3e',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        zIndex: 50,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{
          display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
          backgroundColor: connected ? '#51cf66' : '#ff6b6b',
          border: '2px solid rgba(255,255,255,0.15)',
        }} />
        <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: 1, color: '#eee' }}>
          Agent Matrix
        </span>
      </div>

      <div style={{
        display: 'flex', background: '#1e1e30', border: '1px solid #3a3a4e',
        borderRadius: 6, padding: 2,
      }}>
        {(['dashboard', 'office', 'editor'] as const).map(mode => (
          <button
            key={mode}
            onClick={() => onViewChange(mode)}
            style={{
              padding: '6px 14px', fontSize: 14, fontWeight: 600, borderRadius: 4,
              border: 'none',
              background: viewMode === mode ? '#4a9eff' : 'transparent',
              color: viewMode === mode ? '#fff' : '#888',
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {mode === 'dashboard' ? 'Dashboard' : mode === 'office' ? 'Office' : 'Editor'}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <HeaderButton onClick={onNewSessionClick} label="+ New" title="Start a new Claude session" />
        <HeaderButton onClick={onSessionsClick} label="Sessions" title="Browse active sessions" badge={sessionCount} />
        <HeaderButton onClick={onResumeClick} label="Resume" title="Resume a past session" />
        <HeaderButton onClick={onTasksClick} label="Tasks" title="View task board" />

        {/* More menu */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            title="More options"
            style={{
              width: 38, height: 38, borderRadius: 6,
              border: '1px solid #3a3a4e', background: '#1e1e30',
              color: '#c8c8d8', fontSize: 20, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'inherit',
            }}
          >
            &#9881;
          </button>
          {menuOpen && (
            <DropdownMenu
              onClose={() => setMenuOpen(false)}
              items={[
                { label: 'Settings', onClick: onSettingsClick },
                { label: 'Hooks Config', onClick: onSetupClick },
              ]}
            />
          )}
        </div>
      </div>
    </header>
  );
}
