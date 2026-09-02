'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CommentsController,
  FileChange,
  FileDiff,
  DiffMode,
  DiffPresentation,
  ReviewSendMode,
  SessionDiffCoreCallbacks,
} from './types';
import { detectLanguage } from './editorConfig';
import { useChangedFiles, useComments, useFileDiff } from './hooks';
import { useCommentAnnotations } from './useCommentAnnotations';
import { ChangedFilesList } from './ChangedFilesList';
import { DiffPane } from './DiffPane';
import { CommentsPanel } from './CommentsPanel';
import { CommentComposerPopover } from './CommentComposerPopover';
import { RevertControls } from './RevertControls';
import { ReviewActions } from './ReviewActions';
import { DiffCoreStyles } from './DiffCoreStyles';

export interface SessionDiffCoreProps extends SessionDiffCoreCallbacks {
  sessionId: string;
  sessionName: string;
  cwd?: string;
  socketRef: React.RefObject<any>;
  // 'embedded' (default) fills its parent; 'modal' is used inside the legacy
  // fixed-position wrapper. The core never renders the fixed overlay itself.
  presentation?: DiffPresentation;
  // Optional shared comment source. When omitted the core owns its own.
  commentsController?: CommentsController;
  // Element used to clamp the floating popover. Defaults to the core's root.
  containerRef?: React.RefObject<HTMLElement | null>;
  // Optional header injection points (e.g. a mode toggle or close button)
  // rendered at the far-left / far-right of the core's own header row.
  headerLeft?: React.ReactNode;
  headerRight?: React.ReactNode;
  // Hide the built-in header entirely (parent renders its own chrome).
  hideHeader?: boolean;
  // Repository-relative or absolute file to select once changes are loaded.
  initialPath?: string;
  providedFiles?: FileChange[];
  loadFileDiff?: (file: FileChange, signal: AbortSignal) => Promise<FileDiff>;
  snapshotRef?: string;
  readOnlyEvidence?: boolean;
  evidenceNotice?: React.ReactNode;
}

// Reusable, layout-agnostic core of the changes review experience: changed-file
// list, Monaco diff pane, comment decorations/composer, revert controls, and
// review actions. Owns its own fetch state unless a commentsController is
// supplied. It makes no assumptions about fixed-position modal layout.
export default function SessionDiffCore({
  sessionId,
  sessionName,
  socketRef,
  presentation = 'embedded',
  commentsController,
  containerRef,
  headerLeft,
  headerRight,
  hideHeader = false,
  initialPath,
  providedFiles,
  loadFileDiff,
  snapshotRef,
  readOnlyEvidence = false,
  evidenceNotice,
  onOpenFullFile,
  onClose,
  onSendReviewAll,
  onSendReviewComment,
}: SessionDiffCoreProps) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diffMode, setDiffMode] = useState<DiffMode>(
    () => snapshotRef ? 'split' : 'inline',
  );
  const [reverting, setReverting] = useState(false);
  const [sending, setSending] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const popoverContainerRef = containerRef ?? rootRef;

  const provided = providedFiles !== undefined;
  const legacyFiles =
    useChangedFiles(sessionId, socketRef, { enabled: !provided });
  const files = providedFiles ?? legacyFiles.files;
  const filesLoading = provided ? false : legacyFiles.loading;
  const filesError = provided ? null : legacyFiles.error;
  const [providedDiff, setProvidedDiff] = useState<FileDiff | null>(null);
  const [providedDiffLoading, setProvidedDiffLoading] = useState(false);
  const [providedDiffError, setProvidedDiffError] = useState<string | null>(null);
  const legacyDiff = useFileDiff(
    sessionId,
    selectedFile,
    legacyFiles.changeSignal,
    { enabled: !provided },
  );
  const selectedEntry = files.find(file => file.path === selectedFile) ?? null;

  useEffect(() => {
    if (!provided || !selectedEntry || !loadFileDiff) {
      setProvidedDiff(null);
      setProvidedDiffLoading(false);
      setProvidedDiffError(null);
      return;
    }
    const controller = new AbortController();
    setProvidedDiff(null);
    setProvidedDiffLoading(true);
    setProvidedDiffError(null);
    loadFileDiff(selectedEntry, controller.signal)
      .then(value => {
        setProvidedDiff(value);
        setProvidedDiffLoading(false);
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        setProvidedDiffError(
          error instanceof Error ? error.message : 'Failed to load review snapshot.',
        );
        setProvidedDiffLoading(false);
      });
    return () => controller.abort();
  }, [loadFileDiff, provided, selectedEntry]);

  const diff = provided ? providedDiff : legacyDiff.diff;
  const loadingDiff = provided ? providedDiffLoading : legacyDiff.loading;
  const diffError = provided ? providedDiffError : legacyDiff.error;

  // Own comments only when a controller isn't provided by the parent.
  const ownedComments = useComments(sessionId, {
    enabled: !commentsController,
    snapshotRef,
  });
  const cc: CommentsController = commentsController ?? ownedComments;
  const comments = cc.comments;

  const annotations = useCommentAnnotations({
    containerRef: popoverContainerRef,
    activeFilePath: selectedFile,
    comments,
    revision: diff,
    snapshotRef,
    onAddComment: cc.addComment,
    onDeleteComment: cc.deleteComment,
  });

  const fileComments = useMemo(
    () => comments.filter(c => c.filePath === selectedFile),
    [comments, selectedFile],
  );
  const unresolvedCount = useMemo(() => comments.filter(c => !c.resolved).length, [comments]);
  const resolvedCount = useMemo(() => comments.filter(c => c.resolved).length, [comments]);
  const language = selectedFile ? detectLanguage(selectedFile) : 'plaintext';

  useEffect(() => {
    if (selectedFile !== null || !initialPath || files.length === 0) return;
    const target = initialPath.replaceAll('\\', '/').toLocaleLowerCase();
    const match = files.find(file => {
      const candidate = file.path.replaceAll('\\', '/').toLocaleLowerCase();
      return candidate === target || candidate.endsWith(`/${target}`);
    });
    if (match) setSelectedFile(match.path);
  }, [files, initialPath, selectedFile]);

  // === Revert / clear-tracking actions (explicit failures) ===
  const postChangeAction = useCallback(async (body: Record<string, unknown>, label: string) => {
    const res = await fetch('/api/sessions/changes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, ...body }),
    });
    if (!res.ok) throw new Error(`${label} failed (${res.status})`);
  }, [sessionId]);

  const handleRevertFile = useCallback(async (filePath: string) => {
    setReverting(true);
    try {
      await postChangeAction({ action: 'revert-file', file: filePath }, 'revert file');
      if (selectedFile === filePath) setSelectedFile(null);
      legacyFiles.reload();
    } catch (err) {
      console.error('[diff-core] Failed to revert file:', err);
    } finally {
      setReverting(false);
    }
  }, [postChangeAction, selectedFile, legacyFiles.reload]);

  const handleRevertAll = useCallback(async () => {
    if (!confirm('Revert all changes? This will restore files to their reconstructed pre-session state.')) return;
    setReverting(true);
    try {
      await postChangeAction({ action: 'revert-all' }, 'revert all');
      setSelectedFile(null);
      legacyFiles.reload();
    } catch (err) {
      console.error('[diff-core] Failed to revert all changes:', err);
    } finally {
      setReverting(false);
    }
  }, [postChangeAction, legacyFiles.reload]);

  const handleClearTracking = useCallback(async () => {
    try {
      await postChangeAction({ action: 'clear-tracking' }, 'clear tracking');
      legacyFiles.setFiles([]);
      setSelectedFile(null);
    } catch (err) {
      console.error('[diff-core] Failed to clear tracking:', err);
    }
  }, [postChangeAction, legacyFiles.setFiles]);

  // === Review send (delegated to parent; terminal-injection stays there) ===
  const handleSendAll = useCallback(async (mode: ReviewSendMode) => {
    const unresolved = comments.filter(c => !c.resolved);
    if (unresolved.length === 0 || !onSendReviewAll) return;
    setSending(true);
    try {
      await onSendReviewAll(unresolved, mode);
    } finally {
      setSending(false);
    }
  }, [comments, onSendReviewAll]);

  const handleSendComment = useCallback(async (comment: Parameters<NonNullable<typeof onSendReviewComment>>[0], mode: ReviewSendMode) => {
    if (!onSendReviewComment) return;
    setSending(true);
    try {
      await onSendReviewComment(comment, mode);
      annotations.setPopover(null);
    } finally {
      setSending(false);
    }
  }, [onSendReviewComment, annotations]);

  const openFullFile = useCallback(() => {
    if (!selectedFile || !onOpenFullFile) return;
    const anchor = annotations.popover
      ? { filePath: selectedFile, startLine: annotations.popover.line, endLine: annotations.popover.endLine }
      : { filePath: selectedFile, startLine: 1, endLine: 1 };
    onOpenFullFile(anchor);
  }, [selectedFile, onOpenFullFile, annotations.popover]);

  const showComments = selectedFile != null && diff != null;

  return (
    <div
      ref={rootRef}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: '#131316' }}
    >
      <DiffCoreStyles />
      {evidenceNotice}

      {!hideHeader && (
        <div style={{
          padding: presentation === 'embedded' ? '8px 10px' : '12px 20px',
          borderBottom: '1px solid #26262e',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {headerLeft}
            <span style={{ fontSize: 15, fontWeight: 700, color: '#fafafa' }}>{sessionName}</span>
            {files.length > 0 && (
              <span style={{ fontSize: 12, color: '#71717a', fontWeight: 400 }}>({files.length} files)</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <div style={{ display: 'flex', background: '#1c1c22', border: '1px solid #33333c', borderRadius: 8, padding: 2, gap: 2 }}>
              {(['inline', 'split'] as const).map(mode => (
                <button key={mode} onClick={() => setDiffMode(mode)}
                  className={`cv-seg ${diffMode === mode ? 'cv-seg--active' : ''}`}>
                  {mode === 'inline' ? 'Inline' : 'Split'}
                </button>
              ))}
            </div>
            {files.length > 0 && !readOnlyEvidence && (
              <button onClick={handleClearTracking} className="cv-btn-outline">Clear Tracked</button>
            )}
            {headerRight}
            {onClose && presentation === 'embedded' && (
              <button type="button" onClick={onClose} className="cv-icon-btn" title="Close" aria-label="Close diff">&times;</button>
            )}
          </div>
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Sidebar: changed files */}
        <div style={{
          width: presentation === 'embedded' ? 180 : 280,
          borderRight: '1px solid #26262e',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
        }}>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <ChangedFilesList
              files={files}
              selectedFile={selectedFile}
              onSelect={setSelectedFile}
              comments={comments}
              loading={filesLoading}
              error={filesError}
            />
          </div>
        </div>

        {/* Editor + comments */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
            <DiffPane
              hasSelection={selectedFile != null}
              diff={diff}
              language={language}
              diffMode={diffMode}
              loading={loadingDiff}
              error={diffError}
              onMount={annotations.handleDiffMount}
            />
            {onOpenFullFile && selectedFile && diff && (
              <button onClick={openFullFile} className="cv-btn-outline"
                title="Open full file"
                style={{ position: 'absolute', top: 8, right: 12, zIndex: 5 }}>
                Open File
              </button>
            )}
          </div>

          {showComments && (
            <CommentsPanel comments={fileComments} onDelete={annotations.handleDeleteComment} />
          )}
        </div>
      </div>

      {/* Footer: revert + review actions */}
      <div style={{
        padding: '10px 16px', borderTop: '1px solid #26262e',
        display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0,
      }}>
        {files.length > 0 && !readOnlyEvidence && (
          <RevertControls
            selectedFile={selectedFile}
            reverting={reverting}
            onRevertFile={() => selectedFile && handleRevertFile(selectedFile)}
            onRevertAll={handleRevertAll}
          />
        )}
        <div style={{ flex: 1 }} />
        {onSendReviewAll && (
          <ReviewActions
            totalComments={comments.length}
            unresolvedCount={unresolvedCount}
            resolvedCount={resolvedCount}
            sending={sending}
            onSend={handleSendAll}
          />
        )}
      </div>

      {annotations.popover && (
        <CommentComposerPopover
          popover={annotations.popover}
          commentText={annotations.commentText}
          setCommentText={annotations.setCommentText}
          floatingInputRef={annotations.floatingInputRef}
          sending={sending}
          onAdd={annotations.handleAddComment}
          onDismiss={annotations.dismissPopover}
          onDelete={annotations.handleDeleteComment}
          onSendComment={onSendReviewComment ? handleSendComment : undefined}
        />
      )}
    </div>
  );
}
