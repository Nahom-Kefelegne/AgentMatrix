'use client';

import { useState, useRef, useEffect } from 'react';
import { useThemeContext } from './ThemeProvider';

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
  editorUnlocked?: boolean;
}

export default function HeaderBar({
  connected, sessionCount, onSettingsClick, onSetupClick, onTasksClick,
  onResumeClick, onSessionsClick, onNewSessionClick, viewMode, onViewChange, editorUnlocked,
}: HeaderBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { theme, toggleTheme } = useThemeContext();

  useEffect(() => {
    if (!menuOpen) return;
    const h = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menuOpen]);

  const modes = [
    { key: 'dashboard' as const, label: 'Dashboard' },
    { key: 'office' as const, label: 'Office' },
    ...(editorUnlocked ? [{ key: 'editor' as const, label: 'Editor' }] : []),
  ];

  return (
    <header className="header">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div className={`connection-dot ${connected ? 'connection-dot--on' : 'connection-dot--off'}`} />
        <span className="header-title">Agent Matrix</span>
      </div>

      <div className="view-toggle">
        {modes.map(m => (
          <button key={m.key} onClick={() => onViewChange(m.key)}
            className={`view-toggle-btn ${viewMode === m.key ? 'view-toggle-btn--active' : ''}`}>
            {m.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button className="glass-btn" onClick={onNewSessionClick}>+ New</button>
        <button className="glass-btn" onClick={onSessionsClick}>
          Sessions
          {sessionCount > 0 && <span className="count-badge">{sessionCount}</span>}
        </button>
        <button className="glass-btn" onClick={onResumeClick}>Resume</button>
        <button className="glass-btn" onClick={onTasksClick}>Tasks</button>
        <button className="glass-btn glass-btn--icon" onClick={toggleTheme}>
          {theme === 'dark' ? '☀' : '☽'}
        </button>
        <div ref={menuRef} style={{ position: 'relative' }}>
          <button className="glass-btn glass-btn--icon" onClick={() => setMenuOpen(!menuOpen)}>⋮</button>
          {menuOpen && (
            <div className="dropdown">
              <button className="dropdown-item" onClick={() => { onSettingsClick(); setMenuOpen(false); }}>Settings</button>
              <button className="dropdown-item" onClick={() => { onSetupClick(); setMenuOpen(false); }}>Hooks Config</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
