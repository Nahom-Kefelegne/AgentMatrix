'use client';

import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ConnectionDot } from '@/components/ui/status-indicator';
import { ThemeToggle } from '@/components/ui/theme-toggle';

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

function ViewToggle({ viewMode, onViewChange, editorUnlocked }: {
  viewMode: string;
  onViewChange: (mode: 'office' | 'dashboard' | 'editor') => void;
  editorUnlocked?: boolean;
}) {
  const modes = [
    { key: 'dashboard' as const, label: 'Dashboard' },
    { key: 'office' as const, label: 'Office' },
    ...(editorUnlocked ? [{ key: 'editor' as const, label: 'Editor' }] : []),
  ];

  return (
    <div className="flex bg-glass-bg backdrop-blur-xl border border-glass-border rounded-xl p-0.5">
      {modes.map(m => (
        <button
          key={m.key}
          onClick={() => onViewChange(m.key)}
          className={cn(
            'px-4 py-1.5 rounded-[10px] text-sm font-semibold transition-all duration-200 cursor-pointer',
            viewMode === m.key
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

function MoreMenu({ onSettingsClick, onSetupClick }: {
  onSettingsClick: () => void;
  onSetupClick: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const items = [
    { label: 'Settings', onClick: onSettingsClick },
    { label: 'Hooks Config', onClick: onSetupClick },
  ];

  return (
    <div ref={ref} className="relative">
      <Button variant="glass" size="icon" onClick={() => setOpen(!open)} title="More options">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/>
        </svg>
      </Button>
      {open && (
        <div className="absolute top-full right-0 mt-2 min-w-[180px] z-50 bg-glass-bg backdrop-blur-xl border border-glass-border rounded-xl overflow-hidden shadow-[var(--glass-shadow)]">
          {items.map((item, i) => (
            <button
              key={i}
              onClick={() => { item.onClick(); setOpen(false); }}
              className={cn(
                'w-full px-4 py-2.5 text-left text-sm font-medium cursor-pointer',
                'text-foreground/80 hover:text-foreground hover:bg-muted/50 transition-colors',
                i < items.length - 1 && 'border-b border-border/50',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function HeaderBar({
  connected, sessionCount, onSettingsClick, onSetupClick, onTasksClick,
  onResumeClick, onSessionsClick, onNewSessionClick, viewMode, onViewChange, editorUnlocked,
}: HeaderBarProps) {
  return (
    <header className="fixed top-0 inset-x-0 h-[var(--header-height)] z-50 flex items-center justify-between px-5">
      {/* Left */}
      <div className="flex items-center gap-3">
        <ConnectionDot connected={connected} />
        <span className="text-xl font-bold tracking-tight text-foreground">Agent Matrix</span>
      </div>

      {/* Center */}
      <ViewToggle viewMode={viewMode} onViewChange={onViewChange} editorUnlocked={editorUnlocked} />

      {/* Right */}
      <div className="flex items-center gap-2">
        <Button variant="glass" onClick={onNewSessionClick}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
          New
        </Button>
        <Button variant="glass" onClick={onSessionsClick}>
          Sessions
          {sessionCount > 0 && (
            <span className="ml-1 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-xs font-bold">
              {sessionCount}
            </span>
          )}
        </Button>
        <Button variant="glass" onClick={onResumeClick}>Resume</Button>
        <Button variant="glass" onClick={onTasksClick}>Tasks</Button>
        <ThemeToggle />
        <MoreMenu onSettingsClick={onSettingsClick} onSetupClick={onSetupClick} />
      </div>
    </header>
  );
}
