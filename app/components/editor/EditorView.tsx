'use client';

import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import dynamic from 'next/dynamic';
import FileTree from './FileTree';
import EditorTabs from './EditorTabs';
import GitPanel from './GitPanel';
import PathPicker from './PathPicker';

const MonacoWrapper = dynamic(() => import('./MonacoWrapper'), { ssr: false });
const EditorTerminal = dynamic(() => import('./EditorTerminal'), { ssr: false });

interface OpenFile {
  path: string;
  content: string;
  language: string;
  modified: boolean;
  originalContent: string;
}

/* ────────────────────────────────────────────
   File Search Overlay (Cmd+P / Ctrl+P style)
   ──────────────────────────────────────────── */

interface FileSearchResult {
  name: string;
  path: string;
  dir: string;
}

function FileSearchOverlay({
  rootPath,
  onSelect,
  onClose,
}: {
  rootPath: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FileSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const searchFiles = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return; }
    setLoading(true);
    try {
      // Use the editor search API to find files by name
      const res = await fetch(`/api/editor?action=search&path=${encodeURIComponent(rootPath)}&query=${encodeURIComponent(q)}&mode=files`);
      const data = await res.json();
      // Deduplicate by file path
      const seen = new Set<string>();
      const files: FileSearchResult[] = [];
      for (const r of data.results || []) {
        if (seen.has(r.file)) continue;
        seen.add(r.file);
        const name = r.file.split('/').pop() || r.file;
        const dir = r.file.replace(rootPath + '/', '').replace('/' + name, '');
        files.push({ name, path: r.file, dir });
      }
      setResults(files.slice(0, 20));
    } catch {
      setResults([]);
    }
    setLoading(false);
  }, [rootPath]);

  // Also do a filename-only search using the tree endpoint
  const searchFileNames = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/editor/search-files?root=${encodeURIComponent(rootPath)}&q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setResults((data.files || []).slice(0, 30));
    } catch {
      // Fallback: use content search but show unique files
      await searchFiles(q);
    }
    setLoading(false);
  }, [rootPath, searchFiles]);

  const handleInput = useCallback((value: string) => {
    setQuery(value);
    setSelectedIdx(0);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchFileNames(value), 200);
  }, [searchFileNames]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && results.length > 0) {
      onSelect(results[selectedIdx].path);
      onClose();
    }
  }, [results, selectedIdx, onSelect, onClose]);

  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200,
      }} />
      <div style={{
        position: 'fixed',
        top: 80,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 560,
        background: '#12121e',
        border: '1px solid #2a2a3a',
        borderRadius: 10,
        boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
        zIndex: 201,
        overflow: 'hidden',
      }}>
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #1a1a2e' }}>
          <input
            ref={inputRef}
            value={query}
            onChange={e => handleInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search files by name..."
            style={{
              width: '100%',
              padding: '8px 10px',
              borderRadius: 6,
              border: 'none',
              background: '#0e0e1a',
              color: '#e0e0e0',
              fontSize: 14,
              outline: 'none',
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            }}
          />
        </div>
        <div style={{ maxHeight: 360, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: 16, color: '#888', fontSize: 13, textAlign: 'center' }}>Searching...</div>
          ) : results.length === 0 && query ? (
            <div style={{ padding: 16, color: '#666', fontSize: 13, textAlign: 'center' }}>No files found</div>
          ) : results.length === 0 ? (
            <div style={{ padding: 16, color: '#555', fontSize: 13, textAlign: 'center' }}>
              Type to search for files
            </div>
          ) : (
            results.map((f, idx) => (
              <div
                key={f.path}
                onClick={() => { onSelect(f.path); onClose(); }}
                onMouseEnter={() => setSelectedIdx(idx)}
                style={{
                  padding: '8px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  background: idx === selectedIdx ? 'rgba(74, 158, 255, 0.12)' : 'transparent',
                }}
              >
                <span style={{
                  fontSize: 13,
                  color: idx === selectedIdx ? '#e0e0e0' : '#c8c8d8',
                  fontWeight: idx === selectedIdx ? 600 : 400,
                }}>
                  {f.name}
                </span>
                <span style={{
                  fontSize: 11,
                  color: '#555',
                  fontFamily: "'JetBrains Mono', monospace",
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: 300,
                  marginLeft: 12,
                }}>
                  {f.dir}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}

/* ────────────────────────────────────────────
   Content Search Panel (Cmd+Shift+F style)
   ──────────────────────────────────────────── */

function ContentSearchPanel({
  rootPath,
  onOpenFile,
}: {
  rootPath: string;
  onOpenFile: (path: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [glob, setGlob] = useState('');
  const [results, setResults] = useState<{ file: string; line: number; content: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      let url = `/api/editor?action=search&path=${encodeURIComponent(rootPath)}&query=${encodeURIComponent(query)}`;
      if (glob.trim()) url += `&glob=${encodeURIComponent(glob.trim())}`;
      const res = await fetch(url);
      const data = await res.json();
      setResults(data.results || []);
    } catch {
      setResults([]);
    }
    setLoading(false);
  }, [query, glob, rootPath]);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: '#12121e',
    }}>
      <div style={{ padding: '8px 10px', borderBottom: '1px solid #1a1a2e', flexShrink: 0 }}>
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSearch(); }}
          placeholder="Search in files..."
          style={{
            width: '100%',
            padding: '6px 8px',
            borderRadius: 4,
            border: '1px solid #2a2a3a',
            background: '#0e0e1a',
            color: '#e0e0e0',
            fontSize: 12,
            outline: 'none',
            fontFamily: "'JetBrains Mono', monospace",
            marginBottom: 4,
          }}
        />
        <input
          value={glob}
          onChange={e => setGlob(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSearch(); }}
          placeholder="File filter (e.g. *.ts)"
          style={{
            width: '100%',
            padding: '4px 8px',
            borderRadius: 4,
            border: '1px solid #222',
            background: '#0e0e1a',
            color: '#c8c8d8',
            fontSize: 11,
            outline: 'none',
            fontFamily: "'JetBrains Mono', monospace",
          }}
        />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', fontSize: 12 }}>
        {loading ? (
          <div style={{ padding: 12, color: '#888', textAlign: 'center' }}>Searching...</div>
        ) : results.length === 0 ? (
          <div style={{ padding: 12, color: '#555', textAlign: 'center' }}>
            {query ? 'No results' : 'Enter a search term'}
          </div>
        ) : (
          results.map((r, i) => (
            <div
              key={`${r.file}-${r.line}-${i}`}
              onClick={() => onOpenFile(r.file)}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(74,158,255,0.08)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              style={{ padding: '4px 10px', cursor: 'pointer', borderBottom: '1px solid #1a1a2e' }}
            >
              <div style={{ color: '#4a9eff', fontSize: 11, marginBottom: 1 }}>
                {r.file.replace(rootPath + '/', '')}:{r.line}
              </div>
              <div style={{
                color: '#c8c8d8',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {r.content}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────
   Main Editor View
   ──────────────────────────────────────────── */

export default function EditorView() {
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(250);
  const [bottomPanel, setBottomPanel] = useState<'none' | 'git' | 'terminal'>('none');
  const [bottomPanelHeight, setBottomPanelHeight] = useState(220);
  const [showFileSearch, setShowFileSearch] = useState(false);
  const [sidebarPanel, setSidebarPanel] = useState<'files' | 'search'>('files');
  const [terminalId] = useState(() => `editor-term-${Date.now()}`);
  const [terminalSpawned, setTerminalSpawned] = useState(false);
  const draggingSidebar = useRef(false);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'p' && !e.shiftKey) {
        e.preventDefault();
        setShowFileSearch(true);
      }
      if (mod && e.shiftKey && e.key === 'f') {
        e.preventDefault();
        setSidebarPanel('search');
      }
      if (mod && e.shiftKey && e.key === 'g') {
        e.preventDefault();
        setBottomPanel(p => p === 'git' ? 'none' : 'git');
      }
      if (mod && e.key === '`') {
        e.preventDefault();
        setBottomPanel(p => p === 'terminal' ? 'none' : 'terminal');
        setTerminalSpawned(true);
      }
      if (mod && e.key === 'b') {
        e.preventDefault();
        setSidebarWidth(w => w > 0 ? 0 : 250);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

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

  const openFile = useCallback(async (filePath: string) => {
    const existing = openFiles.find(f => f.path === filePath);
    if (existing) {
      setActiveFile(filePath);
      return;
    }
    try {
      const res = await fetch(`/api/editor?action=read&path=${encodeURIComponent(filePath)}`);
      const data = await res.json();
      if (data.error) return;
      setOpenFiles(prev => [...prev, {
        path: filePath,
        content: data.content,
        language: data.language,
        modified: false,
        originalContent: data.content,
      }]);
      setActiveFile(filePath);
    } catch {}
  }, [openFiles]);

  const closeFile = useCallback((filePath: string) => {
    const file = openFiles.find(f => f.path === filePath);
    if (file?.modified) {
      if (!confirm(`${filePath.split('/').pop()} has unsaved changes. Close anyway?`)) return;
    }
    setOpenFiles(prev => prev.filter(f => f.path !== filePath));
    if (activeFile === filePath) {
      const idx = openFiles.findIndex(f => f.path === filePath);
      const remaining = openFiles.filter(f => f.path !== filePath);
      if (remaining.length > 0) {
        setActiveFile(remaining[Math.min(idx, remaining.length - 1)].path);
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
      if (data.error) return;
      setOpenFiles(prev => prev.map(f =>
        f.path === activeFile
          ? { ...f, modified: false, originalContent: f.content }
          : f
      ));
    } catch {}
  }, [activeFile, openFiles]);

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

  if (!rootPath) {
    return (
      <div style={{
        position: 'fixed', top: 'var(--header-height)',
        left: 0, right: 0, bottom: 0, background: '#0a0a14',
      }}>
        <PathPicker onSelect={setRootPath} />
      </div>
    );
  }

  const sidebarVisible = sidebarWidth > 0;

  return (
    <div style={{
      position: 'fixed', top: 'var(--header-height)',
      left: 0, right: 0, bottom: 0,
      display: 'flex', flexDirection: 'column',
      background: '#0a0a14',
    }}>

      {/* ─── Top Toolbar ─── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        height: 34,
        background: '#0e0e1a',
        borderBottom: '1px solid #1a1a2e',
        padding: '0 8px',
        gap: 2,
        flexShrink: 0,
      }}>
        {/* Left: sidebar toggle + panel buttons */}
        <ToolbarButton
          active={sidebarVisible && sidebarPanel === 'files'}
          label="Files"
          title="Explorer (Cmd+B)"
          onClick={() => {
            if (sidebarPanel === 'files' && sidebarVisible) setSidebarWidth(0);
            else { setSidebarPanel('files'); if (!sidebarVisible) setSidebarWidth(250); }
          }}
        />
        <ToolbarButton
          active={sidebarVisible && sidebarPanel === 'search'}
          label="Search"
          title="Search in Files (Cmd+Shift+F)"
          onClick={() => {
            if (sidebarPanel === 'search' && sidebarVisible) setSidebarWidth(0);
            else { setSidebarPanel('search'); if (!sidebarVisible) setSidebarWidth(250); }
          }}
        />

        <div style={{ width: 1, height: 16, background: '#2a2a3a', margin: '0 6px' }} />

        <ToolbarButton
          active={bottomPanel === 'git'}
          label="Git"
          title="Source Control (Cmd+Shift+G)"
          onClick={() => setBottomPanel(p => p === 'git' ? 'none' : 'git')}
        />
        <ToolbarButton
          active={bottomPanel === 'terminal'}
          label="Terminal"
          title="Terminal (Cmd+`)"
          onClick={() => { setBottomPanel(p => p === 'terminal' ? 'none' : 'terminal'); setTerminalSpawned(true); }}
        />

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Right: quick open + change folder */}
        <ToolbarButton
          label="Go to File"
          title="Quick Open (Cmd+P)"
          onClick={() => setShowFileSearch(true)}
        />

        <div style={{ width: 1, height: 16, background: '#2a2a3a', margin: '0 6px' }} />

        {/* Current folder */}
        <span style={{
          fontSize: 11, color: '#666',
          fontFamily: "'JetBrains Mono', monospace",
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          maxWidth: 300,
        }}>
          {rootPath}
        </span>
        <ToolbarButton
          label="Change"
          title="Open different folder"
          onClick={() => setRootPath(null)}
        />
      </div>

      {/* ─── Main Area ─── */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>

        {/* Sidebar */}
        {sidebarVisible && (
          <>
            <div style={{
              width: sidebarWidth,
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              borderRight: '1px solid #1a1a2e',
              minHeight: 0,
            }}>
              {sidebarPanel === 'files' ? (
                <>
                  <div style={{
                    padding: '6px 10px',
                    borderBottom: '1px solid #1a1a2e',
                    flexShrink: 0,
                  }}>
                    <span style={{
                      fontSize: 11, fontWeight: 700, color: '#888',
                      textTransform: 'uppercase', letterSpacing: 1,
                    }}>
                      Explorer
                    </span>
                  </div>
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <FileTree
                      rootPath={rootPath}
                      activeFile={activeFile}
                      modifiedFiles={modifiedFiles}
                      onFileSelect={(path) => {
                        const existing = openFiles.find(f => f.path === path);
                        if (existing) setActiveFile(path);
                      }}
                      onFileOpen={openFile}
                    />
                  </div>
                </>
              ) : (
                <ContentSearchPanel rootPath={rootPath} onOpenFile={openFile} />
              )}
            </div>

            {/* Sidebar resize handle */}
            <div
              onMouseDown={handleSidebarDragStart}
              style={{
                width: 4, cursor: 'col-resize',
                background: 'transparent', flexShrink: 0, zIndex: 10,
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#4a9eff')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            />
          </>
        )}

        {/* Editor area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
          <EditorTabs
            files={openFiles}
            activeFile={activeFile}
            onSelectTab={setActiveFile}
            onCloseTab={closeFile}
          />

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
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
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  height: '100%', background: '#0e0e1a',
                  flexDirection: 'column', gap: 16,
                }}>
                  <div style={{ fontSize: 48, color: '#222', opacity: 0.5 }}>{'\u2756'}</div>
                  <div style={{ fontSize: 14, color: '#555' }}>
                    Double-click a file to open it
                  </div>
                  <div style={{ fontSize: 12, color: '#444', display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
                    <span>Cmd+P — Search files</span>
                    <span>Cmd+Shift+F — Search in files</span>
                    <span>Cmd+Shift+G — Toggle git panel</span>
                    <span>Cmd+` — Toggle terminal</span>
                    <span>Cmd+S — Save</span>
                  </div>
                </div>
              )}
            </div>

            {/* Bottom panel: Git or Terminal */}
            {bottomPanel !== 'none' && (
              <div style={{
                height: bottomPanelHeight,
                flexShrink: 0,
                display: 'flex',
                flexDirection: 'column',
                borderTop: '1px solid #2a2a3a',
                position: 'relative',
              }}>
                {/* Resize handle */}
                <div
                  onMouseDown={(e) => {
                    e.preventDefault();
                    const startY = e.clientY;
                    const startH = bottomPanelHeight;
                    const onMove = (ev: MouseEvent) => {
                      setBottomPanelHeight(Math.max(100, Math.min(600, startH + (startY - ev.clientY))));
                    };
                    const onUp = () => {
                      document.removeEventListener('mousemove', onMove);
                      document.removeEventListener('mouseup', onUp);
                    };
                    document.addEventListener('mousemove', onMove);
                    document.addEventListener('mouseup', onUp);
                  }}
                  style={{
                    height: 4, cursor: 'row-resize', background: '#1a1a2e',
                    flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <div style={{ width: 40, height: 2, background: '#3a3a4e', borderRadius: 1 }} />
                </div>

                {/* Panel tabs */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  height: 28,
                  background: '#0e0e1a',
                  borderBottom: '1px solid #1a1a2e',
                  padding: '0 8px',
                  gap: 2,
                  flexShrink: 0,
                }}>
                  <ToolbarButton
                    active={bottomPanel === 'terminal'}
                    label="Terminal"
                    onClick={() => { setBottomPanel('terminal'); setTerminalSpawned(true); }}
                  />
                  <ToolbarButton
                    active={bottomPanel === 'git'}
                    label="Source Control"
                    onClick={() => setBottomPanel('git')}
                  />
                  <div style={{ flex: 1 }} />
                  <ToolbarButton
                    label={'\u00D7'}
                    title="Close panel"
                    onClick={() => setBottomPanel('none')}
                  />
                </div>

                {/* Panel content */}
                <div style={{ flex: 1, minHeight: 0 }}>
                  {bottomPanel === 'git' && (
                    <GitPanel
                      rootPath={rootPath}
                      height={bottomPanelHeight - 32}
                      onResize={() => {}}
                    />
                  )}
                  {bottomPanel === 'terminal' && terminalSpawned && (
                    <EditorTerminal
                      terminalId={terminalId}
                      cwd={rootPath}
                      visible={bottomPanel === 'terminal'}
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* File search overlay */}
      {showFileSearch && (
        <FileSearchOverlay
          rootPath={rootPath}
          onSelect={openFile}
          onClose={() => setShowFileSearch(false)}
        />
      )}
    </div>
  );
}

/* ────── Toolbar Button ────── */

function ToolbarButton({
  label,
  title,
  active,
  onClick,
}: {
  label: string;
  title?: string;
  active?: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '3px 10px',
        borderRadius: 4,
        border: 'none',
        background: active ? 'rgba(74, 158, 255, 0.15)' : hovered ? 'rgba(255,255,255,0.06)' : 'transparent',
        color: active ? '#4a9eff' : hovered ? '#c8c8d8' : '#888',
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
        fontFamily: 'inherit',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}
