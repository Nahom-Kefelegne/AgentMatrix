'use client';

import { useState, useCallback, useRef } from 'react';
import { useFormFieldControl } from './Modal';

export function FolderPicker({ value, onChange }: { value: string; onChange: (path: string) => void }) {
  const [dirs, setDirs] = useState<{ name: string; path: string }[]>([]);
  const [open, setOpen] = useState(false);
  const field = useFormFieldControl();
  const triggerRef = useRef<HTMLButtonElement>(null);

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

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        id={field?.controlId}
        ref={triggerRef}
        aria-labelledby={field?.labelId}
        aria-describedby={field?.descriptionId}
        aria-expanded={open}
        className="folder-picker-trigger"
        onKeyDown={event => {
          if (event.key === 'Escape' && open) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            window.requestAnimationFrame(() => triggerRef.current?.focus());
          }
        }}
        onClick={() => { setOpen(!open); if (!open) loadDirs(value); }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
        <span style={{ fontSize: 12, transition: 'transform 0.15s', transform: open ? 'rotate(180deg)' : 'none' }}>▼</span>
      </button>
      {open && (
        <div
          className="folder-picker-dropdown"
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
              window.requestAnimationFrame(() => triggerRef.current?.focus());
            }
          }}
        >
          <button className="folder-picker-item folder-picker-item--action" onClick={navigateUp}>
            ↑ Parent Directory
          </button>
          <button className="folder-picker-item folder-picker-item--drive" onClick={async () => {
            try { const res = await fetch('/api/dirs?drives=true'); const data = await res.json(); if (data.drives && data.dirs?.length) setDirs(data.dirs); } catch {}
          }}>
            Switch Drive
          </button>
          {dirs.map(d => (
            <button key={d.path} className="folder-picker-item"
              onClick={() => { onChange(d.path); loadDirs(d.path); }}
              onDoubleClick={() => { onChange(d.path); setOpen(false); }}>
              📁 {d.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
