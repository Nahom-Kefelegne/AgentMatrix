'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Editor from '@monaco-editor/react';
import { AGENT_MATRIX_THEME } from '@/lib/monacoTheme';
import type { ReviewComment, ReviewSendMode } from './diff-core';
import {
  SessionDiffCore,
  useComments,
  useCommentAnnotations,
  buildFileTree,
  FileIcon,
  FileTreeNode,
  CommentComposerPopover,
  CommentsPanel,
  ReviewActions,
  DiffCoreStyles,
  LoadingSpinner,
  EditorLoading,
  EditorError,
  detectLanguage,
  monacoOpts,
} from './diff-core';
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

interface ChangesViewerProps {
  sessionId: string;
  sessionName: string;
  cwd?: string;
  onClose: () => void;
  socketRef: React.RefObject<any>;
  onSwitchToConsole?: () => void;
}

type ViewMode = 'changes' | 'browse';

// Compatibility modal wrapper around the reusable SessionDiffCore. Owns the
// fixed-position overlay, the Changes/Browse mode toggle, the browse
// (root-picker + file-tree) experience, and the terminal-injection review
// behavior. The changes experience is delegated to SessionDiffCore; comments
// are shared across both modes via a single controller.
export default function ChangesViewer({ sessionId, sessionName, cwd, onClose, socketRef, onSwitchToConsole }: ChangesViewerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('changes');

  // === Browse mode state ===
  const [repoRoot, setRepoRoot] = useState<string | null>(null);
  const [isRepo, setIsRepo] = useState(false);
  const [allFiles, setAllFiles] = useState<string[]>([]);
  const [browseSearch, setBrowseSearch] = useState('');
  const [browseFile, setBrowseFile] = useState<string | null>(null);
  const [browseContent, setBrowseContent] = useState<string | null>(null);
  const [browseLanguage, setBrowseLanguage] = useState('plaintext');
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [loadingBrowse, setLoadingBrowse] = useState(false);
  const [showPathPicker, setShowPathPicker] = useState(false);
  const [pickedPath, setPickedPath] = useState('');
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [browseSending, setBrowseSending] = useState(false);

  const modalRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // === Shared comments (single source of truth across changes + browse) ===
  const cc = useComments(sessionId);
  const comments = cc.comments;

  const browseFullPath = browseFile && repoRoot ? `${repoRoot}/${browseFile}` : null;

  // === Browse comment annotations (decorations, gutter/selection, popover) ===
  const browseAnnotations = useCommentAnnotations({
    containerRef: modalRef,
    activeFilePath: browseFullPath,
    comments,
    revision: browseContent,
    onAddComment: cc.addComment,
    onDeleteComment: cc.deleteComment,
  });

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
      .then(r => {
        if (!r.ok) throw new Error(`repo-root request failed (${r.status})`);
        return r.json();
      })
      .then(data => {
        setRepoRoot(data.root);
        setIsRepo(data.isRepo);
        BROWSE_ROOT_CACHE.set(sessionId, { root: data.root, isRepo: data.isRepo });
      })
      .catch(err => {
        console.error('[changes-viewer] Failed to detect repo root:', err);
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
      .then(r => {
        if (!r.ok) throw new Error(`file index request failed (${r.status})`);
        return r.json();
      })
      .then(data => {
        const files = data.files || [];
        setAllFiles(files);
        setCachedIndex(repoRoot, files);
        setLoadingBrowse(false);
      })
      .catch(err => {
        console.error('[changes-viewer] Failed to index files:', err);
        setLoadingBrowse(false);
      });
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

  // === Load file content for browse mode ===
  useEffect(() => {
    if (viewMode !== 'browse' || !browseFile || !repoRoot) { setBrowseContent(null); return; }
    const ctrl = new AbortController();
    setLoadingBrowse(true);
    setBrowseError(null);
    const fullPath = `${repoRoot}/${browseFile}`;
    fetch(`/api/editor/browse?action=read&path=${encodeURIComponent(fullPath)}`, { signal: ctrl.signal })
      .then(r => {
        if (!r.ok) throw new Error(`read request failed (${r.status})`);
        return r.json();
      })
      .then(data => {
        setBrowseContent(data.content);
        setBrowseLanguage(data.language || detectLanguage(browseFile));
        setLoadingBrowse(false);
      })
      .catch(err => {
        if (ctrl.signal.aborted) return;
        console.error('[changes-viewer] Failed to read file:', err);
        setBrowseError(err instanceof Error ? err.message : 'Failed to read file');
        setBrowseContent(null); setLoadingBrowse(false);
      });
    return () => ctrl.abort();
  }, [browseFile, repoRoot, viewMode]);

  // === Focus search when entering browse ===
  useEffect(() => {
    if (viewMode === 'browse') setTimeout(() => searchInputRef.current?.focus(), 100);
  }, [viewMode]);

  const handleSetRoot = (path: string) => {
    fetch(`/api/editor/browse?action=repo-root&path=${encodeURIComponent(path)}`)
      .then(r => {
        if (!r.ok) throw new Error(`repo-root request failed (${r.status})`);
        return r.json();
      })
      .then(data => {
        const root = data.root || path;
        const repo = data.isRepo || false;
        setRepoRoot(root);
        setIsRepo(repo);
        BROWSE_ROOT_CACHE.set(sessionId, { root, isRepo: repo });
      })
      .catch(err => {
        console.error('[changes-viewer] Failed to set root:', err);
        setRepoRoot(path);
        setIsRepo(false);
        BROWSE_ROOT_CACHE.set(sessionId, { root: path, isRepo: false });
      });
    setAllFiles([]);
    setBrowseFile(null);
    setBrowseContent(null);
    setExpandedDirs(new Set());
  };

  // === Review send (terminal-injection lives here in the wrapper) ===
  const sendReview = useCallback(async (commentsToSend: ReviewComment[], mode: ReviewSendMode) => {
    if (commentsToSend.length === 0) return;
    try {
      const writeRes = await fetch('/api/sessions/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, comments: commentsToSend }),
      });
      if (!writeRes.ok) throw new Error(`review write failed (${writeRes.status})`);
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
          fetch('/api/sessions/review', {
            method: 'DELETE', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId }),
          }).catch(err => console.error('[changes-viewer] Failed to clean up review file:', err));
        }, 60000);
      }
      await cc.resolveAll();
      onClose();
      if (onSwitchToConsole) onSwitchToConsole();
    } catch (err) {
      console.error('[changes-viewer] Failed to send review:', err);
    }
  }, [sessionId, socketRef, cc, onClose, onSwitchToConsole]);

  const sendReviewComment = useCallback(async (comment: ReviewComment, mode: ReviewSendMode) => {
    try {
      const writeRes = await fetch('/api/sessions/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, comments: [comment] }),
      });
      if (!writeRes.ok) throw new Error(`review write failed (${writeRes.status})`);
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
          fetch('/api/sessions/review', {
            method: 'DELETE', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId }),
          }).catch(err => console.error('[changes-viewer] Failed to clean up review file:', err));
        }, 60000);
      }
      await cc.resolveComment(comment.id);
      onClose();
      if (onSwitchToConsole) onSwitchToConsole();
    } catch (err) {
      console.error('[changes-viewer] Failed to send review comment:', err);
    }
  }, [sessionId, socketRef, cc, onClose, onSwitchToConsole]);

  const handleBrowseSendAll = useCallback((mode: ReviewSendMode) => {
    const unresolved = comments.filter(c => !c.resolved);
    if (unresolved.length === 0) return;
    setBrowseSending(true);
    sendReview(unresolved, mode).finally(() => setBrowseSending(false));
  }, [comments, sendReview]);

  const unresolvedCount = comments.filter(c => !c.resolved).length;
  const resolvedCount = comments.filter(c => c.resolved).length;

  const browseFileComments = browseFullPath ? comments.filter(c => c.filePath === browseFullPath) : [];

  const modeToggle = (
    <div style={{ display: 'flex', background: '#1c1c22', border: '1px solid #33333c', borderRadius: 8, padding: 2, gap: 2 }}>
      {(['changes', 'browse'] as const).map(m => (
        <button key={m} onClick={() => setViewMode(m)}
          className={`cv-seg ${viewMode === m ? 'cv-seg--active' : ''}`}>
          {m === 'changes' ? 'Changes' : 'Browse'}
        </button>
      ))}
    </div>
  );

  const closeButton = (
    <button type="button" onClick={onClose} className="cv-icon-btn" title="Close" aria-label="Close changes viewer">&times;</button>
  );

  return (
    <>
      <DiffCoreStyles />

      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', zIndex: 200 }} />
      <div ref={modalRef} style={{
        position: 'fixed', top: '5%', left: '5%', right: '5%', bottom: '5%',
        background: '#131316', border: '1px solid #2a2a30', borderRadius: 16,
        zIndex: 201, display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 24px 80px rgba(0,0,0,0.55)',
        animation: 'cv-modal-in 0.2s ease',
      }}>
        {/* ==================== CHANGES MODE (delegated to SessionDiffCore) ==================== */}
        <div style={{ display: viewMode === 'changes' ? 'flex' : 'none', flexDirection: 'column', flex: viewMode === 'changes' ? 1 : undefined, minHeight: 0 }}>
          <SessionDiffCore
            sessionId={sessionId}
            sessionName={sessionName}
            cwd={cwd}
            socketRef={socketRef}
            presentation="modal"
            commentsController={cc}
            containerRef={modalRef}
            headerLeft={modeToggle}
            headerRight={closeButton}
            onSwitchToConsole={onSwitchToConsole}
            onSendReviewAll={sendReview}
            onSendReviewComment={sendReviewComment}
          />
        </div>

        {/* ==================== BROWSE MODE (owned by wrapper) ==================== */}
        {viewMode === 'browse' && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            {/* Header */}
            <div style={{
              padding: '12px 20px', borderBottom: '1px solid #26262e',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {modeToggle}
                <span style={{ fontSize: 15, fontWeight: 700, color: '#fafafa' }}>
                  {repoRoot?.split('/').pop() || 'Project'}
                </span>
                {allFiles.length > 0 && (
                  <span style={{ fontSize: 12, color: '#71717a', fontWeight: 400 }}>({allFiles.length} files)</span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button onClick={() => { setShowPathPicker(!showPathPicker); setPickedPath(''); }} className="cv-btn-outline">Change Root</button>
                {closeButton}
              </div>
            </div>

            {/* Path picker dropdown */}
            {showPathPicker && (
              <div style={{
                padding: '8px 20px', borderBottom: '1px solid #26262e', background: '#0f0f13',
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
                  background: '#6366f1', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                }}>Set</button>
                <button onClick={() => { setShowPathPicker(false); setPickedPath(''); }} style={{
                  padding: '5px 10px', borderRadius: 6, border: '1px solid #3a3a44',
                  background: 'transparent', color: '#888', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                }}>Cancel</button>
              </div>
            )}

            <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
              {/* Sidebar */}
              <div style={{ width: 280, borderRight: '1px solid #26262e', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
                {/* Search bar + current root */}
                <div style={{ borderBottom: '1px solid #24242c', flexShrink: 0 }}>
                  <div style={{ padding: '8px 10px 4px' }}>
                    <input
                      ref={searchInputRef}
                      value={browseSearch}
                      onChange={e => setBrowseSearch(e.target.value)}
                      placeholder="Search files..."
                      style={{
                        width: '100%', padding: '6px 10px', borderRadius: 6,
                        border: '1px solid #33333c', background: '#1a1a20',
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
                    <span style={{ color: isRepo ? '#51cf66' : '#ffd43b', fontSize: 8 }}>{'\u25CF'}</span>
                    {repoRoot || 'No root set'}
                  </div>
                </div>

                {/* File list */}
                <div style={{ flex: 1, overflowY: 'auto' }}>
                  {loadingBrowse && allFiles.length === 0 ? (
                    <div style={{ padding: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8 }}>
                      <div style={{ width: 20, height: 20, border: '2px solid #222', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                      <span style={{ fontSize: 12, color: '#555' }}>Indexing files...</span>
                    </div>
                  ) : isSearching ? (
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
                            background: isSelected ? '#1e1e26' : 'transparent',
                            borderBottom: '1px solid #24242c',
                            contentVisibility: 'auto', containIntrinsicSize: 'auto 34px',
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
                  )}
                </div>
              </div>

              {/* Editor + comments */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
                  {!browseFile ? (
                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8 }}>
                      <div style={{ fontSize: 14, color: '#555' }}>Search and select a file to view</div>
                      <div style={{ fontSize: 12, color: '#444' }}>Highlight code to add review comments</div>
                    </div>
                  ) : browseError ? (
                    <EditorError message={browseError} />
                  ) : loadingBrowse || browseContent === null ? (
                    <LoadingSpinner />
                  ) : (
                    <Editor
                      value={browseContent}
                      language={browseLanguage}
                      theme={AGENT_MATRIX_THEME}
                      onMount={browseAnnotations.handleEditorMount}
                      options={monacoOpts}
                      loading={<EditorLoading />}
                    />
                  )}
                </div>

                {browseFile && browseContent !== null && (
                  <CommentsPanel comments={browseFileComments} onDelete={browseAnnotations.handleDeleteComment} />
                )}
              </div>
            </div>

            {/* Footer */}
            <div style={{
              padding: '10px 16px', borderTop: '1px solid #26262e',
              display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0,
            }}>
              {repoRoot && (
                <span style={{ fontSize: 11, color: '#999', fontFamily: "'Courier New', monospace", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300 }}>
                  {repoRoot}
                </span>
              )}
              <div style={{ flex: 1 }} />
              <ReviewActions
                totalComments={comments.length}
                unresolvedCount={unresolvedCount}
                resolvedCount={resolvedCount}
                sending={browseSending}
                onSend={handleBrowseSendAll}
              />
            </div>

            {/* Browse popover */}
            {browseAnnotations.popover && (
              <CommentComposerPopover
                popover={browseAnnotations.popover}
                commentText={browseAnnotations.commentText}
                setCommentText={browseAnnotations.setCommentText}
                floatingInputRef={browseAnnotations.floatingInputRef}
                sending={browseSending}
                onAdd={browseAnnotations.handleAddComment}
                onDismiss={browseAnnotations.dismissPopover}
                onDelete={browseAnnotations.handleDeleteComment}
                onSendComment={(comment, mode) => { browseAnnotations.setPopover(null); sendReviewComment(comment, mode); }}
              />
            )}
          </div>
        )}
      </div>
    </>
  );
}
