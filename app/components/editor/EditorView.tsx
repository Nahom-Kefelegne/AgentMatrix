'use client';

import { useState, useCallback, useRef, useMemo } from 'react';
import dynamic from 'next/dynamic';
import FileTree from './FileTree';
import EditorTabs from './EditorTabs';
import GitPanel from './GitPanel';
import PathPicker from './PathPicker';

// Lazy load Monaco to avoid SSR issues
const MonacoWrapper = dynamic(() => import('./MonacoWrapper'), { ssr: false });

interface OpenFile {
  path: string;
  content: string;
  language: string;
  modified: boolean;
  originalContent: string; // content at time of open/save, for dirty detection
}

export default function EditorView() {
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(250);
  const [showGitPanel, setShowGitPanel] = useState(false);
  const [gitPanelHeight, setGitPanelHeight] = useState(200);
  const draggingSidebar = useRef(false);

  // Derived state
  const modifiedFiles = useMemo(() => {
    const set = new Set<string>();
    for (const f of openFiles) {
      if (f.modified) set.add(f.path);
    }
    return set;
  }, [openFiles]);

  const activeFileData = useMemo(() => {
    return openFiles.find(f => f.path === activeFile) || null;
  }, [openFiles, activeFile]);

  // File operations
  const openFile = useCallback(async (filePath: string) => {
    // Check if already open
    const existing = openFiles.find(f => f.path === filePath);
    if (existing) {
      setActiveFile(filePath);
      return;
    }

    try {
      const res = await fetch(`/api/editor?action=read&path=${encodeURIComponent(filePath)}`);
      const data = await res.json();
      if (data.error) {
        console.error('Failed to open file:', data.error);
        return;
      }

      setOpenFiles(prev => [...prev, {
        path: filePath,
        content: data.content,
        language: data.language,
        modified: false,
        originalContent: data.content,
      }]);
      setActiveFile(filePath);
    } catch (err) {
      console.error('Failed to open file:', err);
    }
  }, [openFiles]);

  const closeFile = useCallback((filePath: string) => {
    const file = openFiles.find(f => f.path === filePath);
    if (file?.modified) {
      if (!confirm(`${filePath.split('/').pop()} has unsaved changes. Close anyway?`)) return;
    }

    setOpenFiles(prev => prev.filter(f => f.path !== filePath));
    if (activeFile === filePath) {
      // Switch to adjacent tab
      const idx = openFiles.findIndex(f => f.path === filePath);
      const remaining = openFiles.filter(f => f.path !== filePath);
      if (remaining.length > 0) {
        const newIdx = Math.min(idx, remaining.length - 1);
        setActiveFile(remaining[newIdx].path);
      } else {
        setActiveFile(null);
      }
    }
  }, [openFiles, activeFile]);

  const handleContentChange = useCallback((value: string) => {
    if (!activeFile) return;
    setOpenFiles(prev => prev.map(f =>
      f.path === activeFile
        ? { ...f, content: value, modified: value !== f.originalContent }
        : f
    ));
  }, [activeFile]);

  const saveFile = useCallback(async () => {
    if (!activeFile) return;
    const file = openFiles.find(f => f.path === activeFile);
    if (!file) return;

    try {
      const res = await fetch('/api/editor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'write', path: file.path, content: file.content }),
      });
      const data = await res.json();
      if (data.error) {
        console.error('Save failed:', data.error);
        return;
      }

      setOpenFiles(prev => prev.map(f =>
        f.path === activeFile
          ? { ...f, modified: false, originalContent: f.content }
          : f
      ));
    } catch (err) {
      console.error('Save failed:', err);
    }
  }, [activeFile, openFiles]);

  // Sidebar resize
  const handleSidebarDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingSidebar.current = true;
    const onMove = (ev: MouseEvent) => {
      if (!draggingSidebar.current) return;
      setSidebarWidth(Math.max(150, Math.min(500, ev.clientX)));
    };
    const onUp = () => {
      draggingSidebar.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  // Show path picker if no root
  if (!rootPath) {
    return (
      <div style={{
        position: 'fixed',
        top: 'var(--header-height)',
        left: 0,
        right: 0,
        bottom: 0,
        background: '#0a0a14',
      }}>
        <PathPicker onSelect={setRootPath} />
      </div>
    );
  }

  return (
    <div style={{
      position: 'fixed',
      top: 'var(--header-height)',
      left: 0,
      right: 0,
      bottom: 0,
      display: 'flex',
      background: '#0a0a14',
    }}>
      {/* Sidebar - File Tree */}
      <div style={{
        width: sidebarWidth,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid #1a1a2e',
      }}>
        {/* Sidebar header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 10px',
          borderBottom: '1px solid #1a1a2e',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>
            Explorer
          </span>
          <button
            onClick={() => setRootPath(null)}
            title="Change folder"
            style={{
              padding: '2px 6px',
              border: 'none',
              borderRadius: 3,
              background: 'transparent',
              color: '#888',
              fontSize: 12,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {'\u2026'}
          </button>
        </div>

        {/* File tree */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <FileTree
            rootPath={rootPath}
            activeFile={activeFile}
            modifiedFiles={modifiedFiles}
            onFileSelect={(path) => {
              // Single click: if already open, just activate
              const existing = openFiles.find(f => f.path === path);
              if (existing) setActiveFile(path);
            }}
            onFileOpen={openFile}
          />
        </div>
      </div>

      {/* Sidebar resize handle */}
      <div
        onMouseDown={handleSidebarDragStart}
        style={{
          width: 4,
          cursor: 'col-resize',
          background: 'transparent',
          flexShrink: 0,
          zIndex: 10,
        }}
        onMouseEnter={e => (e.currentTarget.style.background = '#4a9eff')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      />

      {/* Main editor area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Tab bar */}
        <EditorTabs
          files={openFiles}
          activeFile={activeFile}
          onSelectTab={setActiveFile}
          onCloseTab={closeFile}
        />

        {/* Editor + Git toggle bar */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {/* Monaco editor area */}
          <div style={{ flex: 1, minHeight: 0 }}>
            {activeFileData ? (
              <MonacoWrapper
                key={activeFileData.path}
                value={activeFileData.content}
                language={activeFileData.language}
                path={activeFileData.path}
                onChange={handleContentChange}
                onSave={saveFile}
              />
            ) : (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                background: '#0e0e1a',
                flexDirection: 'column',
                gap: 12,
              }}>
                <div style={{ fontSize: 48, color: '#222', opacity: 0.5 }}>{'\u2756'}</div>
                <div style={{ fontSize: 14, color: '#555' }}>
                  Double-click a file to open it
                </div>
                <div style={{ fontSize: 12, color: '#444' }}>
                  Ctrl+S / Cmd+S to save
                </div>
              </div>
            )}
          </div>

          {/* Git panel toggle bar */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            padding: '0 8px',
            height: 26,
            background: '#0e0e1a',
            borderTop: '1px solid #1a1a2e',
            flexShrink: 0,
            gap: 8,
          }}>
            <button
              onClick={() => setShowGitPanel(!showGitPanel)}
              style={{
                padding: '2px 8px',
                border: 'none',
                borderRadius: 3,
                background: showGitPanel ? 'rgba(74, 158, 255, 0.15)' : 'transparent',
                color: showGitPanel ? '#4a9eff' : '#888',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Source Control
            </button>
          </div>

          {/* Git panel */}
          {showGitPanel && (
            <GitPanel
              rootPath={rootPath}
              height={gitPanelHeight}
              onResize={setGitPanelHeight}
            />
          )}
        </div>
      </div>
    </div>
  );
}
