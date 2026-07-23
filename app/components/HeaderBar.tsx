'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, useMotionValue, useSpring } from 'framer-motion';
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

function MagneticButton({ children, className, onClick, title, style }: {
  children: React.ReactNode; className?: string; onClick?: () => void;
  title?: string; style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  // Cache the button's rect on enter so the hot onMouseMove path never calls
  // getBoundingClientRect(). Reading layout on every mouse move forces a
  // synchronous full-page layout flush (layout thrashing) — cheap on a light
  // page, but on the heavy dashboard / Windows it made the magnetic follow
  // stutter badly. The rect is stable for the duration of a hover.
  const rectRef = useRef<DOMRect | null>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const springX = useSpring(x, { stiffness: 300, damping: 20 });
  const springY = useSpring(y, { stiffness: 300, damping: 20 });

  const handleEnter = useCallback(() => {
    rectRef.current = ref.current?.getBoundingClientRect() ?? null;
  }, []);

  const handleMouse = useCallback((e: React.MouseEvent) => {
    const rect = rectRef.current;
    if (!rect) return;
    x.set((e.clientX - (rect.left + rect.width / 2)) * 0.35);
    y.set((e.clientY - (rect.top + rect.height / 2)) * 0.35);
  }, [x, y]);

  return (
    <motion.button ref={ref} className={className} onClick={onClick} title={title}
      style={{ ...style, x: springX, y: springY }}
      onMouseEnter={handleEnter}
      onMouseMove={handleMouse}
      onMouseLeave={() => { x.set(0); y.set(0); }}>
      {children}
    </motion.button>
  );
}

export default function HeaderBar({
  connected, sessionCount, onSettingsClick, onSetupClick, onTasksClick,
  onResumeClick, onSessionsClick, onNewSessionClick, viewMode, onViewChange, editorUnlocked,
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
        <MagneticButton className="nav-action" onClick={onSessionsClick}>
          Sessions
          {sessionCount > 0 && <span className="nav-badge-inline">{sessionCount}</span>}
        </MagneticButton>
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
              <button className="dropdown-item" onClick={() => { onSetupClick(); setMenuOpen(false); }}>Hooks Config</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
