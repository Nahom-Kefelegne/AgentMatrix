'use client';

import { useState, useCallback, useEffect, useRef } from 'react';

interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  isFile: boolean;
  size: number;
  ext: string;
}

interface TreeNode {
  entry: FileEntry;
  children: TreeNode[] | null; // null = not loaded yet
  expanded: boolean;
}

interface FileTreeProps {
  rootPath: string;
  activeFile: string | null;
  modifiedFiles: Set<string>;
  onFileSelect: (path: string) => void;
  onFileOpen: (path: string) => void;
  onRefresh?: () => void;
}

function getFileIcon(entry: FileEntry): { label: string; color: string } {
  if (entry.isDir) return { label: '', color: '' }; // handled separately
  const ext = entry.ext.toLowerCase();
  switch (ext) {
    case '.ts': case '.tsx': return { label: 'TS', color: '#4a9eff' };
    case '.js': case '.jsx': return { label: 'JS', color: '#f0db4f' };
    case '.json': return { label: '{}', color: '#f0db4f' };
    case '.md': return { label: 'M', color: '#4a9eff' };
    case '.css': case '.scss': case '.less': return { label: '#', color: '#ff79c6' };
    case '.html': case '.htm': return { label: '<>', color: '#ff922b' };
    case '.py': return { label: 'PY', color: '#51cf66' };
    case '.rs': return { label: 'RS', color: '#ff922b' };
    case '.go': return { label: 'GO', color: '#20c997' };
    case '.java': return { label: 'JV', color: '#ff6b6b' };
    case '.yaml': case '.yml': return { label: 'Y', color: '#ff922b' };
    case '.sh': case '.bash': return { label: '$', color: '#51cf66' };
    case '.svg': return { label: 'SV', color: '#ff79c6' };
    case '.vue': return { label: 'V', color: '#51cf66' };
    default: return { label: '\u00b7', color: '#666' };
  }
}

function TreeItem({
  node,
  depth,
  activeFile,
  modifiedFiles,
  onToggle,
  onSelect,
  onDoubleClick,
  onContextMenu,
}: {
  node: TreeNode;
  depth: number;
  activeFile: string | null;
  modifiedFiles: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  onDoubleClick: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, path: string, isDir: boolean) => void;
}) {
  const isActive = activeFile === node.entry.path;
  const isModified = modifiedFiles.has(node.entry.path);
  const [hovered, setHovered] = useState(false);
  const icon = getFileIcon(node.entry);

  return (
    <>
      <div
        onClick={() => {
          if (node.entry.isDir) onToggle(node.entry.path);
          else onSelect(node.entry.path);
        }}
        onDoubleClick={() => {
          if (node.entry.isFile) onDoubleClick(node.entry.path);
        }}
        onContextMenu={(e) => onContextMenu(e, node.entry.path, node.entry.isDir)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '3px 8px',
          paddingLeft: depth * 16 + 8,
          cursor: 'pointer',
          fontSize: 13,
          color: isActive ? '#fff' : '#c8c8d8',
          background: isActive
            ? 'rgba(74, 158, 255, 0.15)'
            : hovered
              ? 'rgba(255,255,255,0.05)'
              : 'transparent',
          userSelect: 'none',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
        }}
      >
        {/* Expand/collapse arrow for directories */}
        {node.entry.isDir ? (
          <span style={{
            width: 16,
            flexShrink: 0,
            fontSize: 10,
            color: '#888',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            {node.expanded ? '\u25BC' : '\u25B6'}
          </span>
        ) : (
          <span style={{
            width: 16,
            flexShrink: 0,
            fontSize: 9,
            fontWeight: 700,
            color: icon.color,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'monospace',
          }}>
            {icon.label}
          </span>
        )}

        <span style={{
          marginLeft: 4,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          flex: 1,
        }}>
          {node.entry.name}
        </span>

        {isModified && (
          <span style={{
            width: 6, height: 6,
            borderRadius: '50%',
            background: '#ff922b',
            flexShrink: 0,
            marginLeft: 6,
          }} />
        )}
      </div>

      {/* Children */}
      {node.entry.isDir && node.expanded && node.children && (
        node.children.map(child => (
          <TreeItem
            key={child.entry.path}
            node={child}
            depth={depth + 1}
            activeFile={activeFile}
            modifiedFiles={modifiedFiles}
            onToggle={onToggle}
            onSelect={onSelect}
            onDoubleClick={onDoubleClick}
            onContextMenu={onContextMenu}
          />
        ))
      )}
    </>
  );
}

interface ContextMenuState {
  x: number;
  y: number;
  path: string;
  isDir: boolean;
}

export default function FileTree({ rootPath, activeFile, modifiedFiles, onFileSelect, onFileOpen }: FileTreeProps) {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [creating, setCreating] = useState<{ parentPath: string; type: 'file' | 'dir' } | null>(null);
  const [createValue, setCreateValue] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);

  const fetchEntries = useCallback(async (dirPath: string): Promise<FileEntry[]> => {
    try {
      const res = await fetch(`/api/editor?action=tree&path=${encodeURIComponent(dirPath)}`);
      const data = await res.json();
      return data.entries || [];
    } catch {
      return [];
    }
  }, []);

  // Load root
  useEffect(() => {
    if (!rootPath) return;
    (async () => {
      const entries = await fetchEntries(rootPath);
      setTree(entries.map(e => ({ entry: e, children: null, expanded: false })));
    })();
  }, [rootPath, fetchEntries]);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [contextMenu]);

  const toggleDir = useCallback(async (dirPath: string) => {
    const toggle = async (nodes: TreeNode[]): Promise<TreeNode[]> => {
      const result: TreeNode[] = [];
      for (const node of nodes) {
        if (node.entry.path === dirPath) {
          if (node.expanded) {
            result.push({ ...node, expanded: false });
          } else {
            // Load children if not loaded
            let children = node.children;
            if (children === null) {
              const entries = await fetchEntries(dirPath);
              children = entries.map(e => ({ entry: e, children: null, expanded: false }));
            }
            result.push({ ...node, expanded: true, children });
          }
        } else if (node.entry.isDir && node.children) {
          result.push({ ...node, children: await toggle(node.children) });
        } else {
          result.push(node);
        }
      }
      return result;
    };
    setTree(prev => { toggle(prev).then(setTree); return prev; });
  }, [fetchEntries]);

  const handleContextMenu = useCallback((e: React.MouseEvent, path: string, isDir: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, path, isDir });
  }, []);

  const refreshDir = useCallback(async (dirPath: string) => {
    const entries = await fetchEntries(dirPath);
    const newChildren = entries.map(e => ({ entry: e, children: null, expanded: false }));

    const refresh = (nodes: TreeNode[]): TreeNode[] =>
      nodes.map(node => {
        if (node.entry.path === dirPath) {
          return { ...node, children: newChildren, expanded: true };
        }
        if (node.entry.isDir && node.children) {
          return { ...node, children: refresh(node.children) };
        }
        return node;
      });

    // If dirPath is the root
    if (dirPath === rootPath) {
      setTree(newChildren);
    } else {
      setTree(prev => refresh(prev));
    }
  }, [fetchEntries, rootPath]);

  const handleNewFile = useCallback((parentPath: string) => {
    setContextMenu(null);
    setCreating({ parentPath, type: 'file' });
    setCreateValue('');
  }, []);

  const handleNewDir = useCallback((parentPath: string) => {
    setContextMenu(null);
    setCreating({ parentPath, type: 'dir' });
    setCreateValue('');
  }, []);

  const handleRename = useCallback((path: string) => {
    setContextMenu(null);
    setRenaming(path);
    const name = path.split('/').pop() || '';
    setRenameValue(name);
  }, []);

  const handleDelete = useCallback(async (path: string) => {
    setContextMenu(null);
    if (!confirm(`Delete ${path.split('/').pop()}?`)) return;
    try {
      await fetch('/api/editor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', path }),
      });
      // Refresh parent
      const parentDir = path.substring(0, path.lastIndexOf('/'));
      await refreshDir(parentDir || rootPath);
    } catch (err) {
      console.error('Delete failed:', err);
    }
  }, [refreshDir, rootPath]);

  const handleCreateSubmit = useCallback(async () => {
    if (!creating || !createValue.trim()) { setCreating(null); return; }
    const fullPath = creating.parentPath + '/' + createValue.trim();
    try {
      await fetch('/api/editor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: creating.type === 'dir' ? 'createDir' : 'create',
          path: fullPath,
        }),
      });
      await refreshDir(creating.parentPath);
      if (creating.type === 'file') {
        onFileOpen(fullPath);
      }
    } catch (err) {
      console.error('Create failed:', err);
    }
    setCreating(null);
  }, [creating, createValue, refreshDir, onFileOpen]);

  const handleRenameSubmit = useCallback(async () => {
    if (!renaming || !renameValue.trim()) { setRenaming(null); return; }
    const parentDir = renaming.substring(0, renaming.lastIndexOf('/'));
    const newPath = parentDir + '/' + renameValue.trim();
    try {
      await fetch('/api/editor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rename', path: renaming, newPath }),
      });
      await refreshDir(parentDir || rootPath);
    } catch (err) {
      console.error('Rename failed:', err);
    }
    setRenaming(null);
  }, [renaming, renameValue, refreshDir, rootPath]);

  return (
    <div style={{
      height: '100%',
      background: '#12121e',
      overflowY: 'auto',
      overflowX: 'hidden',
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    }}>
      {/* Root label */}
      <div style={{
        padding: '8px 10px',
        fontSize: 11,
        fontWeight: 700,
        color: '#888',
        textTransform: 'uppercase',
        letterSpacing: 1,
        borderBottom: '1px solid #1a1a2e',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {rootPath.split('/').pop() || rootPath}
      </div>

      {/* Tree items */}
      {tree.map(node => (
        <TreeItem
          key={node.entry.path}
          node={node}
          depth={0}
          activeFile={activeFile}
          modifiedFiles={modifiedFiles}
          onToggle={toggleDir}
          onSelect={onFileSelect}
          onDoubleClick={onFileOpen}
          onContextMenu={handleContextMenu}
        />
      ))}

      {/* Create input */}
      {creating && (
        <div style={{
          padding: '4px 8px', background: '#1a1a2e',
          borderTop: '1px solid #2a2a3a',
        }}>
          <input
            autoFocus
            value={createValue}
            onChange={e => setCreateValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleCreateSubmit();
              if (e.key === 'Escape') setCreating(null);
            }}
            onBlur={handleCreateSubmit}
            placeholder={creating.type === 'dir' ? 'Folder name...' : 'File name...'}
            style={{
              width: '100%',
              background: '#0e0e1a',
              border: '1px solid #4a9eff',
              borderRadius: 3,
              color: '#e0e0e0',
              fontSize: 12,
              padding: '4px 6px',
              outline: 'none',
              fontFamily: 'inherit',
            }}
          />
        </div>
      )}

      {/* Rename input (inline, shown as overlay) */}
      {renaming && (
        <div style={{
          position: 'fixed',
          top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          background: '#12121e',
          border: '1px solid #2a2a3a',
          borderRadius: 8,
          padding: 16,
          zIndex: 10000,
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}>
          <div style={{ fontSize: 13, color: '#e0e0e0', marginBottom: 8 }}>Rename</div>
          <input
            autoFocus
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleRenameSubmit();
              if (e.key === 'Escape') setRenaming(null);
            }}
            style={{
              width: 250,
              background: '#0e0e1a',
              border: '1px solid #4a9eff',
              borderRadius: 4,
              color: '#e0e0e0',
              fontSize: 13,
              padding: '6px 8px',
              outline: 'none',
              fontFamily: 'inherit',
            }}
          />
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
            background: '#1a1a2a',
            border: '1px solid #2a2a3e',
            borderRadius: 6,
            padding: '4px 0',
            minWidth: 160,
            zIndex: 10000,
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          }}
        >
          {[
            { label: 'New File', action: () => handleNewFile(contextMenu.isDir ? contextMenu.path : contextMenu.path.substring(0, contextMenu.path.lastIndexOf('/'))) },
            { label: 'New Folder', action: () => handleNewDir(contextMenu.isDir ? contextMenu.path : contextMenu.path.substring(0, contextMenu.path.lastIndexOf('/'))) },
            { label: 'Rename', action: () => handleRename(contextMenu.path) },
            { label: 'Delete', action: () => handleDelete(contextMenu.path) },
          ].map(item => (
            <div
              key={item.label}
              onClick={item.action}
              onMouseEnter={e => (e.currentTarget.style.background = '#222238')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              style={{
                padding: '6px 14px',
                fontSize: 13,
                color: item.label === 'Delete' ? '#ff6b6b' : '#e0e0e0',
                cursor: 'pointer',
              }}
            >
              {item.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
