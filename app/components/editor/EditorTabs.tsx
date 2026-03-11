'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

interface OpenFile {
  path: string;
  content: string;
  language: string;
  modified: boolean;
}

interface EditorTabsProps {
  files: OpenFile[];
  activeFile: string | null;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
}

function getFileName(filePath: string): string {
  return filePath.split('/').pop() || filePath;
}

function Tab({
  file,
  isActive,
  onSelect,
  onClose,
}: {
  file: OpenFile;
  isActive: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Middle click to close
    if (e.button === 1) {
      e.preventDefault();
      onClose();
    }
  }, [onClose]);

  const handleCloseClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onClose();
  }, [onClose]);

  return (
    <div
      onClick={onSelect}
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={file.path}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px',
        fontSize: 13,
        color: isActive ? '#e0e0e0' : '#888',
        background: isActive ? '#1a1a2e' : '#0e0e1a',
        borderRight: '1px solid #1a1a2e',
        borderBottom: isActive ? '2px solid #4a9eff' : '2px solid transparent',
        cursor: 'pointer',
        userSelect: 'none',
        whiteSpace: 'nowrap',
        flexShrink: 0,
        position: 'relative',
      }}
    >
      {/* Modified dot */}
      {file.modified && (
        <span style={{
          fontSize: 14,
          color: '#ff922b',
          lineHeight: 1,
        }}>
          {'\u25CF'}
        </span>
      )}

      <span>{getFileName(file.path)}</span>

      {/* Close button */}
      <span
        onClick={handleCloseClick}
        style={{
          width: 18,
          height: 18,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 3,
          fontSize: 14,
          color: '#888',
          background: hovered ? 'rgba(255,255,255,0.1)' : 'transparent',
          opacity: hovered || isActive ? 1 : 0,
          transition: 'opacity 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.15)'; e.currentTarget.style.color = '#fff'; }}
        onMouseLeave={e => { e.currentTarget.style.background = hovered ? 'rgba(255,255,255,0.1)' : 'transparent'; e.currentTarget.style.color = '#888'; }}
      >
        {'\u00D7'}
      </span>
    </div>
  );
}

export default function EditorTabs({ files, activeFile, onSelectTab, onCloseTab }: EditorTabsProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Scroll active tab into view
  useEffect(() => {
    if (!containerRef.current || !activeFile) return;
    const activeEl = containerRef.current.querySelector(`[data-path="${CSS.escape(activeFile)}"]`);
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }, [activeFile]);

  if (files.length === 0) {
    return (
      <div style={{
        height: 36,
        background: '#0e0e1a',
        borderBottom: '1px solid #1a1a2e',
      }} />
    );
  }

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        overflowX: 'auto',
        overflowY: 'hidden',
        background: '#0e0e1a',
        borderBottom: '1px solid #1a1a2e',
        scrollbarWidth: 'thin',
        flexShrink: 0,
      }}
    >
      {files.map(file => (
        <div key={file.path} data-path={file.path}>
          <Tab
            file={file}
            isActive={file.path === activeFile}
            onSelect={() => onSelectTab(file.path)}
            onClose={() => onCloseTab(file.path)}
          />
        </div>
      ))}
    </div>
  );
}
