'use client';

import { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';

export function FolderPicker({ value, onChange }: { value: string; onChange: (path: string) => void }) {
  const [dirs, setDirs] = useState<{ name: string; path: string }[]>([]);
  const [open, setOpen] = useState(false);

  const loadDirs = useCallback(async (parentPath: string) => {
    try {
      const res = await fetch(`/api/dirs?path=${encodeURIComponent(parentPath)}`);
      const data = await res.json();
      setDirs(data.dirs || []);
    } catch { setDirs([]); }
  }, []);

  const navigateUp = () => {
    const isWinRoot = /^[A-Za-z]:[\\\/]?$/.test(value);
    if (isWinRoot || value === '/' || value === '\\') return;
    const normalized = value.replace(/\\/g, '/');
    const parts = normalized.split('/').filter(Boolean);
    parts.pop();
    let parent: string;
    if (parts.length === 0) {
      parent = /^[A-Za-z]:/.test(normalized) ? normalized.slice(0, 2) + '\\' : '/';
    } else if (/^[A-Za-z]:$/.test(parts[0])) {
      parent = parts.join('\\') + '\\';
    } else {
      parent = '/' + parts.join('/');
    }
    onChange(parent);
    loadDirs(parent);
  };

  const switchDrive = async () => {
    try {
      const res = await fetch('/api/dirs?drives=true');
      const data = await res.json();
      if (data.drives && data.dirs?.length) setDirs(data.dirs);
    } catch {}
  };

  return (
    <div className="relative">
      <div
        onClick={() => { setOpen(!open); if (!open) loadDirs(value); }}
        className={cn(
          'w-full bg-muted/40 border border-border rounded-xl px-3.5 py-2.5',
          'text-sm font-mono text-foreground cursor-pointer',
          'flex justify-between items-center',
          'hover:border-foreground/20 transition-colors',
        )}
      >
        <span className="truncate">{value}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
          className={cn('text-muted-foreground transition-transform', open && 'rotate-180')}>
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </div>
      {open && (
        <div className="absolute top-full left-0 right-0 z-[110] mt-1 bg-card border border-border rounded-xl max-h-56 overflow-y-auto shadow-lg">
          <button onClick={navigateUp} className="w-full px-3.5 py-2.5 text-sm text-primary font-medium text-left cursor-pointer hover:bg-muted/50 border-b border-border/50 transition-colors">
            ↑ Parent Directory
          </button>
          <button onClick={switchDrive} className="w-full px-3.5 py-2.5 text-sm text-amber-600 dark:text-amber-400 font-medium text-left cursor-pointer hover:bg-muted/50 border-b border-border/50 transition-colors">
            Switch Drive
          </button>
          {dirs.map(d => (
            <button
              key={d.path}
              onClick={() => { onChange(d.path); loadDirs(d.path); }}
              onDoubleClick={() => { onChange(d.path); setOpen(false); }}
              className="w-full px-3.5 py-2.5 text-sm text-foreground/80 text-left cursor-pointer hover:bg-muted/50 border-b border-border/30 last:border-b-0 transition-colors"
            >
              <span className="text-muted-foreground mr-2">📁</span>{d.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
