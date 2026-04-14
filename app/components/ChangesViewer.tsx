'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { DiffEditor, type DiffOnMount } from '@monaco-editor/react';
import Editor, { type OnMount } from '@monaco-editor/react';
import type { editor as monacoEditor } from 'monaco-editor';
import { defineAgentMatrixTheme, AGENT_MATRIX_THEME } from '@/lib/monacoTheme';
import type { ReviewComment } from '@/lib/types';
import { FolderPicker } from './ui/FolderPicker';

// Module-level file index cache — persists across re-renders/remounts, not page reloads
const FILE_INDEX_CACHE = new Map<string, { files: string[]; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 min
const CACHE_MAX = 10;

function getCachedIndex(root: string): string[] | null {
  const entry = FILE_INDEX_CACHE.get(root);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) { FILE_INDEX_CACHE.delete(root); return null; }
  return entry.files;
}

function setCachedIndex(root: string, files: string[]) {
  // Evict oldest if at capacity
  if (FILE_INDEX_CACHE.size >= CACHE_MAX) {
    const oldest = [...FILE_INDEX_CACHE.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) FILE_INDEX_CACHE.delete(oldest[0]);
  }
  FILE_INDEX_CACHE.set(root, { files, ts: Date.now() });
}

// Module-level browse root cache — persists user's chosen root per session
const BROWSE_ROOT_CACHE = new Map<string, { root: string; isRepo: boolean }>();

function detectLanguage(filePath: string): string {
  const ext = ('.' + (filePath.split('.').pop() || '')).toLowerCase();
  const map: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
    '.json': 'json', '.md': 'markdown', '.css': 'css', '.scss': 'scss', '.less': 'less',
    '.html': 'html', '.htm': 'html', '.xml': 'xml', '.svg': 'xml',
    '.py': 'python', '.rs': 'rust', '.go': 'go', '.java': 'java',
    '.c': 'c', '.cpp': 'cpp', '.h': 'c', '.hpp': 'cpp',
    '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell',
    '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml',
    '.sql': 'sql', '.graphql': 'graphql', '.gql': 'graphql',
    '.rb': 'ruby', '.php': 'php', '.swift': 'swift', '.kt': 'kotlin',
  };
  const basename = filePath.split('/').pop()?.split('\\').pop()?.toLowerCase() || '';
  if (basename === 'dockerfile') return 'dockerfile';
  if (basename === 'makefile') return 'makefile';
  return map[ext] || 'plaintext';
}

// === File tree ===

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
}

function buildFileTree(files: string[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', isDir: true, children: [] };
  for (const file of files) {
    const parts = file.split('/');
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const pathSoFar = parts.slice(0, i + 1).join('/');
      let child = current.children.find(c => c.name === part);
      if (!child) {
        child = { name: part, path: pathSoFar, isDir: !isLast, children: [] };
        current.children.push(child);
      }
      current = child;
    }
  }
  // Sort: dirs first, then files, alpha within each
  function sortTree(nodes: TreeNode[]) {
    nodes.sort((a, b) => {
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
    for (const n of nodes) if (n.isDir) sortTree(n.children);
  }
  sortTree(root.children);
  return root.children;
}

// File type colors (VS Code Material Icon Theme)
const FILE_COLORS: Record<string, string> = {
  ts: '#3178c6', tsx: '#1a6fb5', js: '#f0db4f', jsx: '#61dafb',
  json: '#cbcb41', css: '#563d7c', scss: '#cd6799', less: '#1d365d',
  html: '#e44d26', xml: '#e44d26', svg: '#ffb13b',
  md: '#519aba', py: '#3572a5', rs: '#dea584', go: '#00add8',
  java: '#b07219', c: '#555', cpp: '#f34b7d', h: '#555',
  rb: '#cc342d', php: '#4f5d95', swift: '#f05138', kt: '#a97bff',
  sh: '#4ec962', bash: '#4ec962', zsh: '#4ec962',
  yaml: '#cb171e', yml: '#cb171e', toml: '#9c4121',
  sql: '#e38c00', graphql: '#e535ab', gql: '#e535ab',
  png: '#a074c4', jpg: '#a074c4', gif: '#a074c4', ico: '#a074c4',
  lock: '#555', env: '#faf743',
  gitignore: '#f05032', dockerfile: '#2496ed',
};

function FileIcon({ name }: { name: string }) {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const baseName = name.toLowerCase();
  const color = FILE_COLORS[baseName] || FILE_COLORS[ext] || '#666';

  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <path d="M3 1.5h6.5L13 5v9.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-13z" fill={color} fillOpacity="0.15" stroke={color} strokeWidth="1" />
      <path d="M9.5 1.5V5H13" stroke={color} strokeWidth="1" />
    </svg>
  );
}

function FileTreeNode({ node, depth, selected, expanded, onSelect, onToggle, commentCounts }: {
  node: TreeNode; depth: number; selected: string | null;
  expanded: Set<string>; onSelect: (path: string) => void;
  onToggle: (path: string) => void;
  commentCounts: Map<string, number>;
}) {
  const isOpen = expanded.has(node.path);
  const isSelected = selected === node.path;
  const count = commentCounts.get(node.path) || 0;

  if (node.isDir) {
    return (
      <>
        <div
          onClick={() => onToggle(node.path)}
          style={{
            padding: '3px 8px 3px',
            paddingLeft: 12 + depth * 16,
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 13, color: '#ccc', fontWeight: 600,
            background: 'transparent',
            userSelect: 'none',
          }}
          onMouseEnter={e => e.currentTarget.style.background = '#1a1a2e'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          <span style={{ fontSize: 10, color: '#666', width: 12, textAlign: 'center', flexShrink: 0 }}>
            {isOpen ? '\u25BE' : '\u25B8'}
          </span>
          <span style={{ fontSize: 14 }}>{isOpen ? '\uD83D\uDCC2' : '\uD83D\uDCC1'}</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
        </div>
        {isOpen && node.children.map(child => (
          <FileTreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            selected={selected}
            expanded={expanded}
            onSelect={onSelect}
            onToggle={onToggle}
            commentCounts={commentCounts}
          />
        ))}
      </>
    );
  }

  return (
    <div
      onClick={() => onSelect(node.path)}
      style={{
        padding: '3px 8px 3px',
        paddingLeft: 12 + depth * 16,
        cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 6,
        fontSize: 13, color: isSelected ? '#eee' : '#aaa',
        background: isSelected ? '#1a1a2e' : 'transparent',
        userSelect: 'none',
      }}
      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#14141e'; }}
      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
    >
      <FileIcon name={node.name} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{node.name}</span>
      {count > 0 && (
        <span style={{ fontSize: 10, padding: '0 5px', borderRadius: 8, background: '#fbbf2420', color: '#fbbf24', fontWeight: 700, flexShrink: 0 }}>{count}</span>
      )}
    </div>
  );
}

// === Main types ===

interface FileChange { path: string; status: string; additions: number; deletions: number; }

interface ChangesViewerProps {
  sessionId: string;
  sessionName: string;
  cwd?: string;
  onClose: () => void;
  socketRef: React.RefObject<any>;
  onSwitchToConsole?: () => void;
}

interface FloatingPopover {
  mode: 'add' | 'view';
  line: number;
  endLine: number;
  x: number;
  y: number;
  comment?: ReviewComment;
}

type ViewMode = 'changes' | 'browse';

export default function ChangesViewer({ sessionId, sessionName, cwd, onClose, socketRef, onSwitchToConsole }: ChangesViewerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('changes');

  // === Changes mode state ===
  const [files, setFiles] = useState<FileChange[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diff, setDiff] = useState<{ original: string; current: string; isNew: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [reverting, setReverting] = useState(false);
  const [diffMode, setDiffMode] = useState<'inline' | 'split'>('inline');
  const [loadingDiff, setLoadingDiff] = useState(false);

  // === Browse mode state ===
  const [repoRoot, setRepoRoot] = useState<string | null>(null);
  const [isRepo, setIsRepo] = useState(false);
  const [allFiles, setAllFiles] = useState<string[]>([]);
  const [browseSearch, setBrowseSearch] = useState('');
  const [browseFile, setBrowseFile] = useState<string | null>(null);
  const [browseContent, setBrowseContent] = useState<string | null>(null);
  const [browseLanguage, setBrowseLanguage] = useState('plaintext');
  const [loadingBrowse, setLoadingBrowse] = useState(false);
  const [showPathPicker, setShowPathPicker] = useState(false);
  const [pickedPath, setPickedPath] = useState('');
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  // === Shared comment state ===
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [commentText, setCommentText] = useState('');
  const [sending, setSending] = useState(false);
  const [popover, setPopover] = useState<FloatingPopover | null>(null);

  // === Refs ===
  const diffEditorRef = useRef<monacoEditor.IDiffEditor | null>(null);
  const browseEditorRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Parameters<DiffOnMount>[1] | null>(null);
  const decorationsRef = useRef<monacoEditor.IEditorDecorationsCollection | null>(null);
  const browseDecorationsRef = useRef<monacoEditor.IEditorDecorationsCollection | null>(null);
  const floatingInputRef = useRef<HTMLTextAreaElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const mousePos = useRef({ x: 0, y: 0 });
  const commentsRef = useRef(comments);
  commentsRef.current = comments;
  const activeFileRef = useRef<string | null>(null);
  // Track which file is active across modes
  const currentFile = viewMode === 'changes' ? selectedFile : (browseFile ? `${repoRoot}/${browseFile}` : null);
  activeFileRef.current = currentFile;

  const searchInputRef = useRef<HTMLInputElement>(null);

  const statusColors: Record<string, string> = {
    modified: '#ffd43b', new: '#51cf66', deleted: '#ff6b6b', untracked: '#cc5de8',
  };

  // === Mouse tracking ===
  useEffect(() => {
    const handler = (e: MouseEvent) => { mousePos.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener('mousemove', handler);
    return () => window.removeEventListener('mousemove', handler);
  }, []);

  // === Load changed files ===
  const loadFiles = useCallback(() => {
    fetch(`/api/sessions/changes?sessionId=${sessionId}`)
      .then(r => r.json())
      .then(data => { setFiles(data.files || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [sessionId]);
  useEffect(() => {
    loadFiles();
    const interval = setInterval(loadFiles, 5000);
    return () => clearInterval(interval);
  }, [loadFiles]);

  // === Load comments ===
  const loadComments = useCallback(() => {
    fetch(`/api/sessions/comments?sessionId=${sessionId}`)
      .then(r => r.json())
      .then(data => setComments(data.comments || []))
      .catch(() => {});
  }, [sessionId]);
  useEffect(() => { loadComments(); }, [loadComments]);

  // === Detect repo root on mount — skip if user already set a custom root ===
  useEffect(() => {
    if (!cwd) return;
    const cached = BROWSE_ROOT_CACHE.get(sessionId);
    if (cached) {
      setRepoRoot(cached.root);
      setIsRepo(cached.isRepo);
      return;
    }
    fetch(`/api/editor/browse?action=repo-root&path=${encodeURIComponent(cwd)}`)
      .then(r => r.json())
      .then(data => {
        setRepoRoot(data.root);
        setIsRepo(data.isRepo);
        BROWSE_ROOT_CACHE.set(sessionId, { root: data.root, isRepo: data.isRepo });
      })
      .catch(() => {
        setRepoRoot(cwd);
        setIsRepo(false);
        BROWSE_ROOT_CACHE.set(sessionId, { root: cwd, isRepo: false });
      });
  }, [cwd, sessionId]);

  // === Load repo files when browse mode activates or root changes ===
  useEffect(() => {
    if (viewMode !== 'browse' || !repoRoot) return;
    const cached = getCachedIndex(repoRoot);
    if (cached) { setAllFiles(cached); return; }
    setLoadingBrowse(true);
    fetch(`/api/editor/browse?action=files&root=${encodeURIComponent(repoRoot)}`)
      .then(r => r.json())
      .then(data => {
        const files = data.files || [];
        setAllFiles(files);
        setCachedIndex(repoRoot, files);
        setLoadingBrowse(false);
      })
      .catch(() => setLoadingBrowse(false));
  }, [viewMode, repoRoot]);

  // === File tree (built once from allFiles, cheap) ===
  const fileTree = useMemo(() => buildFileTree(allFiles), [allFiles]);

  const toggleDir = useCallback((path: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  // Comment counts per file (for tree badges)
  const browseCommentCounts = useMemo(() => {
    const map = new Map<string, number>();
    if (!repoRoot) return map;
    for (const c of comments) {
      if (c.filePath.startsWith(repoRoot)) {
        const rel = c.filePath.slice(repoRoot.length + 1);
        map.set(rel, (map.get(rel) || 0) + 1);
      }
    }
    return map;
  }, [comments, repoRoot]);

  // === Filtered files for browse search (client-side, instant) ===
  const isSearching = browseSearch.trim().length > 0;
  const filteredBrowseFiles = useMemo(() => {
    if (!isSearching) return [];
    const lower = browseSearch.toLowerCase();
    const terms = lower.split(/\s+/);
    return allFiles
      .filter(f => terms.every(t => f.toLowerCase().includes(t)))
      .slice(0, 200);
  }, [allFiles, browseSearch, isSearching]);

  // === Load diff for changes mode ===
  useEffect(() => {
    if (viewMode !== 'changes') return;
    if (!selectedFile) { setDiff(null); setLoadingDiff(false); return; }
    setLoadingDiff(true); setDiff(null);
    fetch(`/api/sessions/changes?sessionId=${sessionId}&file=${encodeURIComponent(selectedFile)}`)
      .then(r => r.json())
      .then(data => { setDiff(data); setLoadingDiff(false); })
      .catch(() => { setDiff(null); setLoadingDiff(false); });
  }, [selectedFile, sessionId, viewMode]);

  // === Load file content for browse mode ===
  useEffect(() => {
    if (viewMode !== 'browse' || !browseFile || !repoRoot) { setBrowseContent(null); return; }
    setLoadingBrowse(true);
    const fullPath = `${repoRoot}/${browseFile}`;
    fetch(`/api/editor/browse?action=read&path=${encodeURIComponent(fullPath)}`)
      .then(r => r.json())
      .then(data => {
        setBrowseContent(data.content);
        setBrowseLanguage(data.language || detectLanguage(browseFile));
        setLoadingBrowse(false);
      })
      .catch(() => { setBrowseContent(null); setLoadingBrowse(false); });
  }, [browseFile, repoRoot, viewMode]);

  // === Decorations for diff editor ===
  useEffect(() => {
    if (viewMode !== 'changes') return;
    const modified = diffEditorRef.current?.getModifiedEditor();
    if (!modified || !monacoRef.current) return;
    const fileComments = comments.filter(c => c.filePath === selectedFile);
    // Always recreate — the editor model changes when switching files
    decorationsRef.current?.clear();
    decorationsRef.current = modified.createDecorationsCollection(
      fileComments.map(c => ({
        range: new monacoRef.current!.Range(c.lineNumber, 1, c.lineNumber, 1),
        options: {
          glyphMarginClassName: c.resolved ? 'review-comment-glyph--resolved' : 'review-comment-glyph',
          isWholeLine: true,
          className: c.resolved ? 'review-comment-line--resolved' : 'review-comment-line',
          glyphMarginHoverMessage: { value: `${c.resolved ? '(resolved) ' : ''}${c.text}` },
        },
      }))
    );
  }, [comments, selectedFile, diff, viewMode]);

  // === Decorations for browse editor ===
  useEffect(() => {
    if (viewMode !== 'browse') return;
    const editor = browseEditorRef.current;
    if (!editor || !monacoRef.current || !browseFile || !repoRoot) return;
    const fullPath = `${repoRoot}/${browseFile}`;
    const fileComments = comments.filter(c => c.filePath === fullPath);
    browseDecorationsRef.current?.clear();
    browseDecorationsRef.current = editor.createDecorationsCollection(
      fileComments.map(c => ({
        range: new monacoRef.current!.Range(c.lineNumber, 1, c.lineNumber, 1),
        options: {
          glyphMarginClassName: c.resolved ? 'review-comment-glyph--resolved' : 'review-comment-glyph',
          isWholeLine: true,
          className: c.resolved ? 'review-comment-line--resolved' : 'review-comment-line',
          glyphMarginHoverMessage: { value: `${c.resolved ? '(resolved) ' : ''}${c.text}` },
        },
      }))
    );
  }, [comments, browseFile, browseContent, repoRoot, viewMode]);

  // === Focus ===
  useEffect(() => {
    if (popover?.mode === 'add') setTimeout(() => floatingInputRef.current?.focus(), 30);
  }, [popover]);

  useEffect(() => {
    if (viewMode === 'browse') setTimeout(() => searchInputRef.current?.focus(), 100);
  }, [viewMode]);

  // === Clamp popover ===
  const clampPopover = useCallback((rawX: number, rawY: number, popW = 340, popH = 160) => {
    const modal = modalRef.current;
    if (!modal) return { x: rawX, y: rawY };
    const rect = modal.getBoundingClientRect();
    const pad = 12;
    let x = rawX, y = rawY;
    if (x + popW + pad > rect.right) x = rect.right - popW - pad;
    if (x < rect.left + pad) x = rect.left + pad;
    if (y + popH + pad > rect.bottom) y = rawY - popH - 8;
    if (y < rect.top + pad) y = rect.top + pad;
    return { x, y };
  }, []);

  // === Wire up editor interactions (shared between both editors) ===
  function wireEditorInteractions(editor: monacoEditor.IStandaloneCodeEditor, monaco: Parameters<DiffOnMount>[1]) {
    editor.onMouseDown((e) => {
      if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
        const line = e.target.position?.lineNumber;
        if (!line) return;
        const pos = clampPopover(mousePos.current.x, mousePos.current.y);
        const existing = commentsRef.current.find(
          c => c.filePath === activeFileRef.current && c.lineNumber === line
        );
        if (existing) {
          setPopover({ mode: 'view', line, endLine: line, x: pos.x, y: pos.y, comment: existing });
        } else {
          setPopover({ mode: 'add', line, endLine: line, x: pos.x, y: pos.y });
          setCommentText('');
        }
      }
    });
    editor.onMouseUp(() => {
      const sel = editor.getSelection();
      if (!sel || sel.isEmpty()) return;
      setTimeout(() => {
        const pos = clampPopover(mousePos.current.x, mousePos.current.y);
        setPopover({ mode: 'add', line: sel.startLineNumber, endLine: sel.endLineNumber, x: pos.x, y: pos.y });
        setCommentText('');
      }, 50);
    });
  }

  const handleDiffMount: DiffOnMount = useCallback((editor, monaco) => {
    diffEditorRef.current = editor;
    monacoRef.current = monaco;
    defineAgentMatrixTheme(monaco);
    monaco.editor.setTheme(AGENT_MATRIX_THEME);
    wireEditorInteractions(editor.getModifiedEditor(), monaco);
  }, [clampPopover]);

  const handleBrowseMount: OnMount = useCallback((editor, monaco) => {
    browseEditorRef.current = editor;
    monacoRef.current = monaco;
    defineAgentMatrixTheme(monaco);
    monaco.editor.setTheme(AGENT_MATRIX_THEME);
    wireEditorInteractions(editor, monaco);
  }, [clampPopover]);

  // === Comment actions ===
  const handleAddComment = async () => {
    if (!commentText.trim() || !currentFile || !popover) return;
    const text = popover.line !== popover.endLine
      ? `[Lines ${popover.line}-${popover.endLine}] ${commentText.trim()}`
      : commentText.trim();
    await fetch('/api/sessions/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        comment: { filePath: currentFile, lineNumber: popover.line, text },
      }),
    }).then(r => r.json()).then(data => setComments(data.comments || []));
    setCommentText('');
    setPopover(null);
  };

  const dismissPopover = useCallback(() => { setPopover(null); setCommentText(''); }, []);

  const handleDeleteComment = async (commentId: string) => {
    await fetch('/api/sessions/comments', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, commentId }),
    }).then(r => r.json()).then(data => setComments(data.comments || []));
    if (popover?.comment?.id === commentId) setPopover(null);
  };

  const handleRevertFile = async (filePath: string) => {
    setReverting(true);
    await fetch('/api/sessions/changes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, action: 'revert-file', file: filePath }),
    });
    if (selectedFile === filePath) { setSelectedFile(null); setDiff(null); }
    loadFiles();
    setReverting(false);
  };

  const handleRevertAll = async () => {
    if (!confirm('Revert all changes? This will restore all files to their git HEAD state.')) return;
    setReverting(true);
    await fetch('/api/sessions/changes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, action: 'revert-all' }),
    });
    setSelectedFile(null); setDiff(null);
    loadFiles();
    setReverting(false);
  };

  const handleClearTracking = async () => {
    await fetch('/api/sessions/changes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, action: 'clear-tracking' }),
    });
    setFiles([]); setSelectedFile(null); setDiff(null);
  };

  const handleSendSingleComment = async (comment: ReviewComment, mode: 'fix' | 'discuss') => {
    setSending(true);
    try {
      const writeRes = await fetch('/api/sessions/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, comments: [comment] }),
      });
      const { filePath } = await writeRes.json();
      const socket = socketRef.current;
      if (socket) {
        const prompt = mode === 'discuss'
          ? `Read the code review at ${filePath}. Let's discuss this comment — share your thoughts before making changes. Don't delete the review file yet.\r`
          : `Read the code review at ${filePath}. Address the comment by making the requested change. Delete the review file when done.\r`;
        socket.emit('terminal:input', { sessionId, data: prompt });
      }
      if (mode === 'fix') {
        setTimeout(() => {
          fetch('/api/sessions/review', { method: 'DELETE', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId }) }).catch(() => {});
        }, 60000);
      }
      await fetch('/api/sessions/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, action: 'resolve', commentId: comment.id }),
      }).then(r => r.json()).then(data => setComments(data.comments || []));
      setPopover(null);
      onClose();
      if (onSwitchToConsole) onSwitchToConsole();
    } catch (err) { console.error('[review] Failed:', err); }
    setSending(false);
  };

  const handleSendToClaudeReview = async (mode: 'fix' | 'discuss' = 'fix') => {
    const unresolvedComments = comments.filter(c => !c.resolved);
    if (unresolvedComments.length === 0) return;
    setSending(true);
    try {
      const writeRes = await fetch('/api/sessions/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, comments: unresolvedComments }),
      });
      const { filePath } = await writeRes.json();
      const socket = socketRef.current;
      if (socket) {
        const prompt = mode === 'discuss'
          ? `Read the code review at ${filePath}. Let's discuss each comment — share your thoughts on the feedback before making changes. Don't delete the review file yet.\r`
          : `Read the code review at ${filePath}. Address each comment by making the requested changes to the files. Delete the review file when done.\r`;
        socket.emit('terminal:input', { sessionId, data: prompt });
      }
      if (mode === 'fix') {
        setTimeout(() => {
          fetch('/api/sessions/review', { method: 'DELETE', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId }) }).catch(() => {});
        }, 60000);
      }
      await fetch('/api/sessions/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, action: 'resolve-all' }),
      }).then(r => r.json()).then(data => setComments(data.comments || []));
      onClose();
      if (onSwitchToConsole) onSwitchToConsole();
    } catch (err) { console.error('[review] Failed:', err); }
    setSending(false);
  };

  const handleSetRoot = (path: string) => {
    fetch(`/api/editor/browse?action=repo-root&path=${encodeURIComponent(path)}`)
      .then(r => r.json())
      .then(data => {
        const root = data.root || path;
        const repo = data.isRepo || false;
        setRepoRoot(root);
        setIsRepo(repo);
        BROWSE_ROOT_CACHE.set(sessionId, { root, isRepo: repo });
      })
      .catch(() => {
        setRepoRoot(path);
        setIsRepo(false);
        BROWSE_ROOT_CACHE.set(sessionId, { root: path, isRepo: false });
      });
    setAllFiles([]);
    setBrowseFile(null);
    setBrowseContent(null);
    setExpandedDirs(new Set());
  };

  const fileComments = comments.filter(c => c.filePath === currentFile);
  const language = currentFile ? detectLanguage(currentFile) : 'plaintext';
  const unresolvedCount = comments.filter(c => !c.resolved).length;
  const resolvedCount = comments.filter(c => c.resolved).length;

  const monacoOpts = {
    readOnly: true,
    glyphMargin: true,
    minimap: { enabled: false },
    fontSize: 13,
    lineNumbers: 'on' as const,
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
    fontLigatures: true,
    padding: { top: 8 },
    automaticLayout: true,
    folding: true,
    renderOverviewRuler: false,
    overviewRulerLanes: 0,
    hideCursorInOverviewRuler: true,
    overviewRulerBorder: false,
  };

  const loadingSpinner = (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10 }}>
      <div style={{ width: 24, height: 24, border: '3px solid #222', borderTopColor: '#4a9eff', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
      <span style={{ fontSize: 13, color: '#555' }}>Loading...</span>
    </div>
  );

  const editorLoading = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#888', fontSize: 14, background: '#0e0e1a' }}>
      Loading editor...
    </div>
  );

  return (
    <>
      <style>{`
        .review-comment-glyph {
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          cursor: pointer !important;
        }
        .review-comment-glyph::before {
          content: '';
          display: block;
          width: 16px;
          height: 16px;
          border-radius: 4px;
          background: #fbbf24;
          mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24'%3E%3Cpath d='M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'/%3E%3C/svg%3E") center/contain no-repeat;
          -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24'%3E%3Cpath d='M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'/%3E%3C/svg%3E") center/contain no-repeat;
        }
        .review-comment-glyph:hover::before { background: #fcd34d; }
        .review-comment-line {
          background: rgba(251, 191, 36, 0.10) !important;
          border-left: 2px solid rgba(251, 191, 36, 0.4) !important;
        }
        .review-comment-glyph--resolved {
          display: flex !important; align-items: center !important; justify-content: center !important; cursor: pointer !important;
        }
        .review-comment-glyph--resolved::before {
          content: ''; display: block; width: 16px; height: 16px; border-radius: 4px; background: #51cf66; opacity: 0.7;
          mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24'%3E%3Cpath d='M20 6L9 17l-5-5'/%3E%3C/svg%3E") center/contain no-repeat;
          -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24'%3E%3Cpath d='M20 6L9 17l-5-5'/%3E%3C/svg%3E") center/contain no-repeat;
        }
        .review-comment-line--resolved {
          background: rgba(81, 207, 102, 0.06) !important;
          border-left: 2px solid rgba(81, 207, 102, 0.3) !important;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes glass-in {
          from { opacity: 0; transform: scale(0.92) translateY(4px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>

      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200 }} />
      <div ref={modalRef} style={{
        position: 'fixed', top: '5%', left: '5%', right: '5%', bottom: '5%',
        background: '#0c0c18', border: '1px solid #222235', borderRadius: 14,
        zIndex: 201, display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      }}>
        {/* Header */}
        <div style={{
          padding: '12px 20px', borderBottom: '1px solid #1e1e30',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Mode toggle */}
            <div style={{
              display: 'flex', background: '#1a1a2a', border: '1px solid #2a2a3e',
              borderRadius: 6, padding: 2,
            }}>
              {(['changes', 'browse'] as const).map(m => (
                <button key={m} onClick={() => setViewMode(m)} style={{
                  padding: '4px 12px', fontSize: 11, fontWeight: 600, borderRadius: 4,
                  border: 'none',
                  background: viewMode === m ? '#4a9eff' : 'transparent',
                  color: viewMode === m ? '#fff' : '#666',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}>{m === 'changes' ? 'Changes' : 'Browse'}</button>
              ))}
            </div>
            <span style={{ fontSize: 15, fontWeight: 700, color: '#eee' }}>
              {viewMode === 'changes' ? sessionName : (repoRoot?.split('/').pop() || 'Project')}
            </span>
            {viewMode === 'changes' && files.length > 0 && (
              <span style={{ fontSize: 12, color: '#666', fontWeight: 400 }}>({files.length} files)</span>
            )}
            {viewMode === 'browse' && allFiles.length > 0 && (
              <span style={{ fontSize: 12, color: '#666', fontWeight: 400 }}>({allFiles.length} files)</span>
            )}
          </div>

          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {viewMode === 'changes' && (
              <div style={{ display: 'flex', background: '#1a1a2a', border: '1px solid #2a2a3e', borderRadius: 6, padding: 2 }}>
                {(['inline', 'split'] as const).map(mode => (
                  <button key={mode} onClick={() => setDiffMode(mode)} style={{
                    padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 4, border: 'none',
                    background: diffMode === mode ? '#4a9eff' : 'transparent',
                    color: diffMode === mode ? '#fff' : '#666',
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}>{mode === 'inline' ? 'Inline' : 'Split'}</button>
                ))}
              </div>
            )}
            {viewMode === 'browse' && (
              <button onClick={() => { setShowPathPicker(!showPathPicker); setPickedPath(''); }} style={{
                padding: '5px 12px', borderRadius: 6, border: '1px solid #3a3a4e',
                background: 'transparent', color: '#888', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
              }}>Change Root</button>
            )}
            {viewMode === 'changes' && files.length > 0 && (
              <button onClick={handleClearTracking} style={{
                padding: '5px 12px', borderRadius: 6, border: '1px solid #3a3a4e',
                background: 'transparent', color: '#888', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
              }}>Clear Tracked</button>
            )}
            <button onClick={onClose} style={{
              width: 28, height: 28, borderRadius: 6, border: '1px solid #2a2a3e',
              background: '#1a1a2a', color: '#888', fontSize: 14,
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            }}>x</button>
          </div>
        </div>

        {/* Path picker dropdown */}
        {showPathPicker && (
          <div style={{
            padding: '8px 20px', borderBottom: '1px solid #1e1e30', background: '#0a0a16',
            display: 'flex', gap: 8, alignItems: 'center',
          }}>
            <span style={{ fontSize: 12, color: '#888', whiteSpace: 'nowrap' }}>Root:</span>
            <div style={{ flex: 1 }}>
              <FolderPicker value={pickedPath || repoRoot || cwd || '/'} onChange={setPickedPath} />
            </div>
            <button onClick={() => {
              if (pickedPath) handleSetRoot(pickedPath);
              setShowPathPicker(false);
            }} style={{
              padding: '5px 14px', borderRadius: 6, border: 'none',
              background: '#4a9eff', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}>Set</button>
            <button onClick={() => { setShowPathPicker(false); setPickedPath(''); }} style={{
              padding: '5px 10px', borderRadius: 6, border: '1px solid #3a3a4e',
              background: 'transparent', color: '#888', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
            }}>Cancel</button>
          </div>
        )}

        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          {/* ==================== SIDEBAR ==================== */}
          <div style={{ width: 280, borderRight: '1px solid #1e1e30', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
            {/* Browse: search bar + current root */}
            {viewMode === 'browse' && (
              <div style={{ borderBottom: '1px solid #1a1a28', flexShrink: 0 }}>
                <div style={{ padding: '8px 10px 4px' }}>
                  <input
                    ref={searchInputRef}
                    value={browseSearch}
                    onChange={e => setBrowseSearch(e.target.value)}
                    placeholder="Search files..."
                    style={{
                      width: '100%', padding: '6px 10px', borderRadius: 6,
                      border: '1px solid #2a2a3e', background: '#12121e',
                      color: '#eee', fontSize: 13, fontFamily: 'inherit', outline: 'none',
                    }}
                  />
                </div>
                <div style={{
                  padding: '2px 10px 6px', fontSize: 10, color: '#555',
                  fontFamily: "'Courier New', monospace",
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  display: 'flex', alignItems: 'center', gap: 4,
                }}>
                  <span style={{ color: isRepo ? '#51cf66' : '#ffd43b', fontSize: 8 }}>{isRepo ? '\u25CF' : '\u25CF'}</span>
                  {repoRoot || 'No root set'}
                </div>
              </div>
            )}

            {/* File list */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {viewMode === 'changes' ? (
                // Changes file list
                loading ? (
                  <div style={{ padding: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8 }}>
                    <div style={{ width: 20, height: 20, border: '2px solid #222', borderTopColor: '#4a9eff', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                    <span style={{ fontSize: 12, color: '#555' }}>Loading files...</span>
                  </div>
                ) : files.length === 0 ? (
                  <div style={{ padding: 20, color: '#555', textAlign: 'center' }}>No file changes tracked yet</div>
                ) : (
                  files.map(f => {
                    const name = f.path.split('/').pop() || f.path.split('\\').pop() || f.path;
                    const dir = f.path.replace(/[/\\][^/\\]+$/, '');
                    const isSelected = selectedFile === f.path;
                    const commentCount = comments.filter(c => c.filePath === f.path).length;
                    return (
                      <div key={f.path} onClick={() => setSelectedFile(f.path)} style={{
                        padding: '10px 14px', cursor: 'pointer',
                        background: isSelected ? '#1a1a2e' : 'transparent',
                        borderBottom: '1px solid #1a1a28',
                        borderLeft: `3px solid ${statusColors[f.status] || '#888'}`,
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: isSelected ? '#eee' : '#ccc' }}>{name}</div>
                          {commentCount > 0 && (
                            <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 8, background: '#fbbf2420', color: '#fbbf24', fontWeight: 700 }}>{commentCount}</span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: '#999', fontFamily: "'Courier New', monospace", marginTop: 2 }}>{dir}</div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 4, fontSize: 11, alignItems: 'center' }}>
                          <span style={{ color: statusColors[f.status] || '#888', fontWeight: 700 }}>{f.status}</span>
                          {f.additions > 0 && <span style={{ color: '#51cf66' }}>+{f.additions}</span>}
                          {f.deletions > 0 && <span style={{ color: '#ff6b6b' }}>-{f.deletions}</span>}
                        </div>
                      </div>
                    );
                  })
                )
              ) : (
                // Browse: tree or search results
                loadingBrowse && allFiles.length === 0 ? (
                  <div style={{ padding: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8 }}>
                    <div style={{ width: 20, height: 20, border: '2px solid #222', borderTopColor: '#4a9eff', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                    <span style={{ fontSize: 12, color: '#555' }}>Indexing files...</span>
                  </div>
                ) : isSearching ? (
                  // Flat search results
                  filteredBrowseFiles.length === 0 ? (
                    <div style={{ padding: 20, color: '#555', textAlign: 'center' }}>No matches</div>
                  ) : (
                    filteredBrowseFiles.map(f => {
                      const name = f.split('/').pop() || f;
                      const dir = f.includes('/') ? f.replace(/\/[^/]+$/, '') : '';
                      const isSelected = browseFile === f;
                      const count = browseCommentCounts.get(f) || 0;
                      return (
                        <div key={f} onClick={() => setBrowseFile(f)} style={{
                          padding: '5px 14px', cursor: 'pointer',
                          background: isSelected ? '#1a1a2e' : 'transparent',
                          borderBottom: '1px solid #1a1a28',
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <FileIcon name={name} />
                            <span style={{ fontSize: 13, fontWeight: 600, color: isSelected ? '#eee' : '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{name}</span>
                            {count > 0 && (
                              <span style={{ fontSize: 10, padding: '0 5px', borderRadius: 8, background: '#fbbf2420', color: '#fbbf24', fontWeight: 700, flexShrink: 0 }}>{count}</span>
                            )}
                          </div>
                          {dir && (
                            <div style={{ fontSize: 10, color: '#999', fontFamily: "'Courier New', monospace", marginTop: 1, paddingLeft: 18, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dir}</div>
                          )}
                        </div>
                      );
                    })
                  )
                ) : fileTree.length === 0 ? (
                  <div style={{ padding: 20, color: '#555', textAlign: 'center' }}>No files found</div>
                ) : (
                  // Tree view
                  <div style={{ padding: '4px 0' }}>
                    {fileTree.map(node => (
                      <FileTreeNode
                        key={node.path}
                        node={node}
                        depth={0}
                        selected={browseFile}
                        expanded={expandedDirs}
                        onSelect={setBrowseFile}
                        onToggle={toggleDir}
                        commentCounts={browseCommentCounts}
                      />
                    ))}
                  </div>
                )
              )}
            </div>
          </div>

          {/* ==================== EDITOR PANEL ==================== */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
              {viewMode === 'changes' ? (
                // Diff editor
                !selectedFile ? (
                  <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontSize: 14, color: '#555' }}>Select a file to view changes</div>
                    <div style={{ fontSize: 12, color: '#444' }}>Highlight code or click the gutter to add comments</div>
                  </div>
                ) : loadingDiff || !diff ? loadingSpinner : (
                  <DiffEditor
                    original={diff.original}
                    modified={diff.current}
                    language={language}
                    theme={AGENT_MATRIX_THEME}
                    onMount={handleDiffMount}
                    options={{ ...monacoOpts, originalEditable: false, renderSideBySide: diffMode === 'split' }}
                    loading={editorLoading}
                  />
                )
              ) : (
                // Browse editor
                !browseFile ? (
                  <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontSize: 14, color: '#555' }}>Search and select a file to view</div>
                    <div style={{ fontSize: 12, color: '#444' }}>Highlight code to add review comments</div>
                  </div>
                ) : loadingBrowse || browseContent === null ? loadingSpinner : (
                  <Editor
                    value={browseContent}
                    language={browseLanguage}
                    theme={AGENT_MATRIX_THEME}
                    onMount={handleBrowseMount}
                    options={monacoOpts}
                    loading={editorLoading}
                  />
                )
              )}
            </div>

            {/* Comments list panel */}
            {currentFile && (viewMode === 'changes' ? diff : browseContent !== null) && (
              <div style={{
                height: fileComments.length > 0 ? 120 : 36,
                borderTop: '1px solid #1e1e30', background: '#0a0a16',
                display: 'flex', flexDirection: 'column', flexShrink: 0,
                transition: 'height 0.2s ease',
              }}>
                <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
                  {fileComments.length === 0 && (
                    <div style={{ padding: '8px 14px', fontSize: 12, color: '#555', fontStyle: 'italic' }}>
                      Highlight code or click the gutter to add a review comment
                    </div>
                  )}
                  {fileComments.map(c => (
                    <div key={c.id} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '5px 12px', fontSize: 12,
                      opacity: c.resolved ? 0.5 : 1,
                    }}>
                      <span style={{ color: c.resolved ? '#51cf66' : '#fbbf24', fontWeight: 700, minWidth: 50 }}>
                        {c.resolved ? '\u2713' : ''} Line {c.lineNumber}
                      </span>
                      <span style={{ flex: 1, color: '#ccc', textDecoration: c.resolved ? 'line-through' : 'none' }}>{c.text}</span>
                      <button onClick={() => handleDeleteComment(c.id)} style={{
                        padding: '2px 6px', borderRadius: 4, border: '1px solid #ff6b6b30',
                        background: 'transparent', color: '#ff6b6b', fontSize: 10, cursor: 'pointer',
                        fontFamily: 'inherit', fontWeight: 600,
                      }}>x</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '10px 16px', borderTop: '1px solid #1e1e30',
          display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0,
        }}>
          {viewMode === 'changes' && files.length > 0 && (
            <>
              <button onClick={() => selectedFile && handleRevertFile(selectedFile)} disabled={!selectedFile || reverting} style={{
                padding: '6px 14px', borderRadius: 6, border: '1px solid #ff6b6b30',
                background: 'transparent', color: selectedFile ? '#ff6b6b' : '#555',
                fontSize: 12, fontWeight: 600, cursor: selectedFile ? 'pointer' : 'default', fontFamily: 'inherit',
              }}>Revert File</button>
              <button onClick={handleRevertAll} disabled={reverting} style={{
                padding: '6px 14px', borderRadius: 6, border: '1px solid #ff6b6b30',
                background: 'transparent', color: '#ff6b6b', fontSize: 12, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit',
              }}>Revert All</button>
            </>
          )}
          {viewMode === 'browse' && repoRoot && (
            <span style={{ fontSize: 11, color: '#999', fontFamily: "'Courier New', monospace", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300 }}>
              {repoRoot}
            </span>
          )}
          <div style={{ flex: 1 }} />
          {comments.length > 0 && (
            <span style={{ fontSize: 12, fontWeight: 600, display: 'flex', gap: 8 }}>
              {unresolvedCount > 0 && <span style={{ color: '#fbbf24' }}>{unresolvedCount} open</span>}
              {resolvedCount > 0 && <span style={{ color: '#51cf66' }}>{resolvedCount} resolved</span>}
            </span>
          )}
          <button
            onClick={() => handleSendToClaudeReview('discuss')}
            disabled={unresolvedCount === 0 || sending}
            style={{
              padding: '8px 16px', borderRadius: 8,
              border: '1px solid rgba(255, 255, 255, 0.1)',
              background: unresolvedCount > 0 ? 'rgba(255, 255, 255, 0.06)' : '#222',
              color: unresolvedCount > 0 ? '#ccc' : '#555',
              fontSize: 13, fontWeight: 600,
              cursor: unresolvedCount > 0 ? 'pointer' : 'default',
              fontFamily: 'inherit', backdropFilter: 'blur(8px)',
              opacity: sending ? 0.6 : 1, transition: 'all 0.15s',
            }}
          >Discuss</button>
          <button
            onClick={() => handleSendToClaudeReview('fix')}
            disabled={unresolvedCount === 0 || sending}
            style={{
              padding: '8px 20px', borderRadius: 8, border: 'none',
              background: unresolvedCount > 0 ? 'linear-gradient(135deg, #fbbf24, #f59e0b)' : '#222',
              color: unresolvedCount > 0 ? '#000' : '#555',
              fontSize: 13, fontWeight: 700,
              cursor: unresolvedCount > 0 ? 'pointer' : 'default',
              fontFamily: 'inherit', opacity: sending ? 0.6 : 1,
            }}
          >{sending ? 'Acting...' : 'Act'}</button>
        </div>
      </div>

      {/* ==================== FLOATING POPOVER ==================== */}
      {popover && (
        <>
          <div onClick={dismissPopover} style={{ position: 'fixed', inset: 0, zIndex: 300 }} />
          <div onClick={e => e.stopPropagation()} style={{
            position: 'fixed', left: popover.x, top: popover.y, zIndex: 301, width: 340,
            background: 'rgba(12, 12, 24, 0.82)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
            border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: 12,
            boxShadow: '0 16px 48px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.04) inset',
            animation: 'glass-in 0.15s ease', overflow: 'hidden',
          }}>
            <div style={{
              padding: '10px 14px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
            }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#fbbf24', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fbbf24', display: 'inline-block' }} />
                {popover.line === popover.endLine ? `Line ${popover.line}` : `Lines ${popover.line}\u2013${popover.endLine}`}
              </span>
              <button onClick={dismissPopover} style={{
                width: 22, height: 22, borderRadius: 6, border: '1px solid rgba(255,255,255,0.08)',
                background: 'rgba(255,255,255,0.04)', color: '#888', fontSize: 11,
                display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all 0.15s',
              }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = '#ccc'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = '#888'; }}
              >x</button>
            </div>

            {popover.mode === 'view' && popover.comment && (
              <div style={{ padding: '12px 14px' }}>
                {popover.comment.resolved && (
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#51cf66', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 13 }}>{'\u2713'}</span> Resolved
                  </div>
                )}
                <div style={{
                  fontSize: 13, color: popover.comment.resolved ? '#999' : '#e0e0e0', lineHeight: 1.6,
                  padding: '8px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.03)',
                  border: `1px solid ${popover.comment.resolved ? 'rgba(81,207,102,0.15)' : 'rgba(255,255,255,0.05)'}`,
                  textDecoration: popover.comment.resolved ? 'line-through' : 'none',
                }}>{popover.comment.text}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
                  <span style={{ fontSize: 11, color: '#555' }}>
                    {new Date(popover.comment.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <div style={{ flex: 1 }} />
                  <button onClick={() => handleDeleteComment(popover.comment!.id)} style={{
                    padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(255,107,107,0.2)',
                    background: 'rgba(255,107,107,0.08)', color: '#ff6b6b', fontSize: 11, fontWeight: 600,
                    cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
                  }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,107,107,0.15)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,107,107,0.08)'}
                  >Delete</button>
                  {!popover.comment.resolved && (
                    <>
                      <button onClick={() => handleSendSingleComment(popover.comment!, 'discuss')} disabled={sending} style={{
                        padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)',
                        background: 'rgba(255,255,255,0.06)', color: '#ccc', fontSize: 11, fontWeight: 600,
                        cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
                      }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
                      >Discuss</button>
                      <button onClick={() => handleSendSingleComment(popover.comment!, 'fix')} disabled={sending} style={{
                        padding: '4px 10px', borderRadius: 6, border: 'none',
                        background: 'rgba(251,191,36,0.9)', color: '#000', fontSize: 11, fontWeight: 700,
                        cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
                      }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(251,191,36,1)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'rgba(251,191,36,0.9)'}
                      >Act</button>
                    </>
                  )}
                </div>
              </div>
            )}

            {popover.mode === 'add' && (
              <div style={{ padding: '10px 14px 12px' }}>
                <textarea
                  ref={floatingInputRef}
                  value={commentText}
                  onChange={e => setCommentText(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddComment(); }
                    if (e.key === 'Escape') dismissPopover();
                  }}
                  placeholder="Add a review comment..."
                  rows={2}
                  style={{
                    width: '100%', resize: 'none', padding: '8px 10px', borderRadius: 8,
                    border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)',
                    color: '#e0e0e0', fontSize: 13, fontFamily: 'inherit', outline: 'none', lineHeight: 1.5,
                    transition: 'border-color 0.15s',
                  }}
                  onFocus={e => e.currentTarget.style.borderColor = 'rgba(251,191,36,0.3)'}
                  onBlur={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'}
                />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                  <span style={{ fontSize: 11, color: '#555' }}>Enter to add &middot; Esc to cancel</span>
                  <button onClick={handleAddComment} disabled={!commentText.trim()} style={{
                    padding: '5px 16px', borderRadius: 8, border: 'none',
                    background: commentText.trim() ? 'rgba(251,191,36,0.9)' : 'rgba(255,255,255,0.06)',
                    color: commentText.trim() ? '#000' : '#555', fontSize: 12, fontWeight: 700,
                    cursor: commentText.trim() ? 'pointer' : 'default', fontFamily: 'inherit', transition: 'all 0.15s',
                  }}>Add Comment</button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
