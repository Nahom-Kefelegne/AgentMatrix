'use client';

import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useThemeContext } from './ThemeProvider';

interface HeaderBarProps {
  connected: boolean;
  onSettingsClick: () => void;
  onSetupClick: () => void;
  onTasksClick: () => void;
  onResumeClick: () => void;
  onNewSessionClick: () => void;
  viewMode: 'office' | 'dashboard' | 'editor';
  onViewChange: (mode: 'office' | 'dashboard' | 'editor') => void;
  editorUnlocked?: boolean;
}

// Magnetic follow effect removed: it made the nav text stutter on Windows and
// was pure eye-candy. Kept as a thin wrapper (same props) so call sites don't
// change; renders a plain static button.
function MagneticButton({ children, className, onClick, title, style }: {
  children: React.ReactNode; className?: string; onClick?: () => void;
  title?: string; style?: React.CSSProperties;
}) {
  return (
    <button className={className} onClick={onClick} title={title} style={style}>
      {children}
    </button>
  );
}

export default function HeaderBar({
  connected, onSettingsClick, onSetupClick, onTasksClick,
  onResumeClick, onNewSessionClick, viewMode, onViewChange, editorUnlocked,
}: HeaderBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { theme, toggleTheme } = useThemeContext();

  useEffect(() => {
    const check = () => {
      const el = document.querySelector('[data-scroll-area]');
      setScrolled(el ? el.scrollTop > 60 : false);
    };
    const interval = setInterval(check, 200);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const h = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menuOpen]);

  const views = [
    { key: 'dashboard' as const, label: 'Dashboard' },
    { key: 'office' as const, label: 'Office' },
    ...(editorUnlocked ? [{ key: 'editor' as const, label: 'Editor' }] : []),
  ];

  return (
    <div className="nav-wrapper">
      {/* Center pill — view toggle only */}
      <div className={`nav-pill ${scrolled ? 'nav-pill--scrolled' : ''}`}>
        <div style={{ padding: '0 6px', display: 'flex', alignItems: 'center' }}>
          <div className={`connection-dot ${connected ? 'connection-dot--on' : 'connection-dot--off'}`} />
        </div>
        <div className="nav-divider" />
        {views.map(v => (
          <MagneticButton key={v.key}
            className={`nav-link ${viewMode === v.key ? 'nav-link--active' : ''}`}
            onClick={() => onViewChange(v.key)}>
            {viewMode === v.key && (
              <motion.div className="nav-active-bg" layoutId="nav-active"
                transition={{ type: 'spring', stiffness: 380, damping: 30 }} />
            )}
            <span style={{ position: 'relative', zIndex: 1 }}>{v.label}</span>
          </MagneticButton>
        ))}
      </div>

      {/* Right pill — actions */}
      <div className={`nav-pill nav-pill-right ${scrolled ? 'nav-pill--scrolled' : ''}`}>
        <MagneticButton className="nav-action" onClick={onNewSessionClick}>+ New</MagneticButton>
        <div className="nav-divider" />
        <MagneticButton className="nav-action" onClick={onResumeClick}>Resume</MagneticButton>
        <div className="nav-divider" />
        <MagneticButton className="nav-action" onClick={onTasksClick}>Tasks</MagneticButton>
        <div className="nav-divider" />
        <MagneticButton className="nav-icon-btn" onClick={toggleTheme} title="Toggle theme">
          {theme === 'dark' ? '☀' : '☽'}
        </MagneticButton>
        <div ref={menuRef} style={{ position: 'relative', display: 'flex' }}>
          <MagneticButton className="nav-icon-btn" onClick={() => setMenuOpen(!menuOpen)}>⋮</MagneticButton>
          {menuOpen && (
            <div className="dropdown" style={{ top: 'calc(100% + 12px)', right: -4 }}>
              <button className="dropdown-item" onClick={() => { onSettingsClick(); setMenuOpen(false); }}>Settings</button>
              <button className="dropdown-item" onClick={() => { onSetupClick(); setMenuOpen(false); }}>Integration Status</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
