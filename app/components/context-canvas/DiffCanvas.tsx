'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, GitBranch, History } from 'lucide-react';
import type {
  CommentAnchor,
  FileChange,
  FileDiff,
  ReviewComment,
  ReviewSendMode,
} from '../diff-core';
import { SessionDiffCore, useComments } from '../diff-core';
import { useSocketContext } from '../SocketProvider';
import type { NavigationRequest } from '@/lib/navigation/types';
import type {
  ChangesCanvasRequest,
  ReviewSnapshotMeta,
} from '@/lib/canvas/types';
import type { ContextCanvasController } from './useContextCanvas';
import { toPosixPath } from '@/lib/paths/displayPath';

interface DiffCanvasProps {
  sessionId: string;
  sessionName: string;
  cwd?: string;
  request: NavigationRequest;
  canvasRequest?: ChangesCanvasRequest | null;
  controller: ContextCanvasController;
}

const captureTime = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});

function shortSha(value: string | null): string {
  return value?.slice(0, 8) ?? 'none';
}

function baseLabel(snapshot: ReviewSnapshotMeta): string {
  if (snapshot.requestedBaseRef) return snapshot.requestedBaseRef;
  if (snapshot.baseResolution === 'upstream-merge-base') return 'upstream merge-base';
  if (snapshot.baseResolution === 'head-fallback') return 'HEAD';
  if (snapshot.baseResolution === 'unborn') return 'empty repository';
  return 'empty baseline';
}

function relativeToSession(cwd: string | undefined, filePath: string): string {
  const normalizedFile = filePath.replaceAll('\\', '/');
  if (!cwd) return normalizedFile.replace(/^\/+/, '');
  const normalizedRoot = cwd.replaceAll('\\', '/').replace(/\/+$/, '');
  const compareFile = normalizedFile.toLocaleLowerCase();
  const compareRoot = normalizedRoot.toLocaleLowerCase();
  if (compareFile === compareRoot) return normalizedFile.split('/').pop() ?? normalizedFile;
  if (compareFile.startsWith(`${compareRoot}/`)) return normalizedFile.slice(normalizedRoot.length + 1);
  return normalizedFile.replace(/^\/+/, '');
}

export default function DiffCanvas({
  sessionId,
  sessionName,
  cwd,
  request,
  canvasRequest,
  controller,
}: DiffCanvasProps) {
  const { socketRef } = useSocketContext();
  const selection = canvasRequest?.payload.scope === 'selection'
    ? canvasRequest.payload
    : null;
  const snapshotRef = selection?.snapshot.snapshotRef;
  const commentsController = useComments(sessionId, { snapshotRef });
  const [sendError, setSendError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [expired, setExpired] = useState(false);
  const files = useMemo<FileChange[] | undefined>(
    () => selection?.files.map(file => ({
      path: file.path,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      fileId: file.fileId,
      reason: file.reason,
      previousPath: file.previousPath,
      contentAvailable: file.contentAvailable,
      contentKind: file.contentKind,
      unavailableReason: file.unavailableReason,
    })),
    [selection],
  );
  const selectedPaths = useMemo(
    () => new Set(selection?.files.map(file => toPosixPath(file.path)) ?? []),
    [selection],
  );

  useEffect(() => {
    if (!snapshotRef) return;
    let active = true;
    let leaseId: string | null = null;
    let renewalTimer: number | null = null;
    let renewing = false;
    const leaseRequest = (
      action: 'acquire' | 'renew' | 'release',
      keepalive = false,
    ) => fetch('/api/canvas/review/lease', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, snapshotRef, action, leaseId }),
      keepalive,
    });
    leaseRequest('acquire').then(async response => {
      const payload = await response.json().catch(() => null);
      if (!active) {
        if (typeof payload?.leaseId === 'string') {
          leaseId = payload.leaseId;
          void leaseRequest('release', true).catch(() => {});
        }
        return;
      }
      if (response.status === 410) {
        setExpired(true);
        return;
      }
      if (typeof payload?.leaseId === 'string') {
        leaseId = payload.leaseId;
        renewalTimer = window.setInterval(() => {
          if (renewing || !leaseId) return;
          renewing = true;
          void leaseRequest('renew')
            .then(async renewed => {
              if (!active || renewed.status !== 410) return;
              leaseId = null;
              const reacquired = await leaseRequest('acquire');
              const reacquiredPayload = await reacquired.json().catch(() => null);
              if (!active) {
                if (typeof reacquiredPayload?.leaseId === 'string') {
                  leaseId = reacquiredPayload.leaseId;
                  void leaseRequest('release', true).catch(() => {});
                }
                return;
              }
              if (
                reacquired.status === 410
                || typeof reacquiredPayload?.leaseId !== 'string'
              ) {
                setExpired(true);
                return;
              }
              leaseId = reacquiredPayload.leaseId;
              setExpired(false);
            })
            .catch(() => {})
            .finally(() => {
              renewing = false;
            });
        }, 60_000);
      }
    }).catch(error => {
      console.error('[context-canvas] Failed to acquire review snapshot lease:', error);
    });
    const statusParams = new URLSearchParams({ sessionId, snapshotRef });
    fetch(`/api/canvas/review/status?${statusParams.toString()}`)
      .then(async response => {
        const payload = await response.json().catch(() => null);
        if (!active) return;
        if (response.status === 410) setExpired(true);
        else if (response.ok && payload?.stale === true) setStale(true);
      })
      .catch(error => {
        console.error('[context-canvas] Failed to verify review snapshot freshness:', error);
      });
    return () => {
      active = false;
      if (renewalTimer !== null) window.clearInterval(renewalTimer);
      if (leaseId) void leaseRequest('release', true).catch(() => {});
    };
  }, [sessionId, snapshotRef]);

  useEffect(() => {
    if (!selection) return;
    const socket = socketRef.current;
    if (!socket) return;
    const handleFilesChanged = (event: {
      sessionId: string;
      completedAt: number;
      changes?: Array<{ path: string }>;
    }) => {
      if (
        event.sessionId !== sessionId
        || event.completedAt <= selection.snapshot.capturedAt
      ) {
        return;
      }
      if (
        !event.changes
        || event.changes.some(change =>
          selectedPaths.has(toPosixPath(change.path)))
      ) {
        setStale(true);
      }
    };
    socket.on('session:files-changed' as any, handleFilesChanged);
    return () => {
      socket.off('session:files-changed' as any, handleFilesChanged);
    };
  }, [selectedPaths, selection, sessionId, socketRef]);

  const loadSnapshotDiff = useCallback(async (
    file: FileChange,
    signal: AbortSignal,
  ): Promise<FileDiff> => {
    if (!file.fileId) throw new Error('Review file identifier is missing.');
    const params = new URLSearchParams({ sessionId, fileId: file.fileId });
    const response = await fetch(`/api/canvas/review/file?${params.toString()}`, {
      signal,
    });
    const payload = await response.json().catch(() => null);
    if (response.status === 410) {
      setExpired(true);
      throw new Error(payload?.error?.message || 'Review snapshot expired.');
    }
    if (!response.ok) {
      throw new Error(payload?.error?.message || `Review file request failed (${response.status}).`);
    }
    if (payload?.contentAvailable === false) {
      const reason = payload.unavailableReason === 'binary'
        ? 'Binary files cannot be rendered in the text diff.'
        : payload.unavailableReason === 'submodule'
          ? 'Submodule changes are represented by commit IDs, not text.'
          : payload.unavailableReason === 'sparse'
            ? 'This file is unavailable in the sparse working tree.'
            : payload.unavailableReason === 'type_changed'
              ? 'This path changed between a regular file and a submodule.'
            : 'This file exceeds the review content limit.';
      throw new Error(reason);
    }
    return payload as FileDiff;
  }, [sessionId]);

  const deliverReview = useCallback(async (
    comments: ReviewComment[],
    mode: ReviewSendMode,
  ) => {
    if (comments.length === 0) return;
    setSendError(null);
    const response = await fetch('/api/sessions/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, comments }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || typeof payload?.filePath !== 'string') {
      const message = typeof payload?.error === 'string' ? payload.error : `Review delivery failed (${response.status}).`;
      setSendError(message);
      throw new Error(message);
    }
    const prompt = mode === 'discuss'
      ? `Read the code review at ${payload.filePath}. Discuss each comment before making changes. Do not delete the review file yet.\r`
      : `Read the code review at ${payload.filePath}. Address each comment, then delete the review file when done.\r`;
    const socket = socketRef.current;
    if (!socket) {
      const message = 'The session terminal is disconnected. Reconnect it before sending review feedback.';
      setSendError(message);
      throw new Error(message);
    }
    socket.emit('terminal:input', { sessionId, data: prompt });
    if (mode === 'fix') {
      window.setTimeout(() => {
        fetch('/api/sessions/review', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        }).catch(error => console.error('[context-canvas] Failed to clean review artifact:', error));
      }, 60_000);
    }
  }, [sessionId, socketRef]);

  const handleSendAll = useCallback(async (comments: ReviewComment[], mode: ReviewSendMode) => {
    await deliverReview(comments, mode);
    await commentsController.resolveAll();
    controller.backToConversation();
  }, [commentsController, controller, deliverReview]);

  const handleSendComment = useCallback(async (comment: ReviewComment, mode: ReviewSendMode) => {
    await deliverReview([comment], mode);
    await commentsController.resolveComment(comment.id);
    controller.backToConversation();
  }, [commentsController, controller, deliverReview]);

  const handleOpenFullFile = useCallback((anchor: CommentAnchor) => {
    controller.openFile({
      path: relativeToSession(cwd, anchor.filePath),
      range: {
        start: { line: anchor.startLine, column: 1 },
        end: { line: anchor.endLine, column: 1 },
      },
    }, `${stale ? 'Open newer live version of' : 'Open live'} ${anchor.filePath}`);
  }, [controller, cwd, stale]);

  const evidenceNotice = selection ? (
    <div className={`cc-review-provenance ${stale || expired ? 'cc-review-provenance--warning' : ''}`}>
      <div>
        <GitBranch size={13} aria-hidden="true" />
        <strong>
          {selection.snapshot.isGitRepository
            ? `${selection.snapshot.branch || 'Detached HEAD'} · ${shortSha(selection.snapshot.headSha)}`
            : 'Non-Git workspace'}
        </strong>
        <span>
          compared with {baseLabel(selection.snapshot)}
          {selection.snapshot.effectiveBaseSha
            ? ` · ${shortSha(selection.snapshot.effectiveBaseSha)}`
            : ''}
        </span>
      </div>
      <div>
        <History size={12} aria-hidden="true" />
        <span>Captured {captureTime.format(selection.snapshot.capturedAt)}</span>
      </div>
      {expired ? (
        <p>This frozen review expired. Ask the session to present a fresh review.</p>
      ) : stale ? (
        <p>The working tree changed after capture. Comments remain anchored to the frozen review.</p>
      ) : null}
    </div>
  ) : null;

  return (
    <div className="cc-diff">
      {sendError ? (
        <div className="cc-diff-error" role="alert">
          <AlertTriangle size={15} aria-hidden="true" />
          <span>{sendError}</span>
        </div>
      ) : null}
      <SessionDiffCore
        sessionId={sessionId}
        sessionName={sessionName}
        cwd={cwd}
        socketRef={socketRef}
        presentation="embedded"
        initialPath={
          request.target?.path
          ?? request.diff?.filterPaths?.[0]
          ?? files?.[0]?.path
        }
        providedFiles={files}
        loadFileDiff={selection ? loadSnapshotDiff : undefined}
        snapshotRef={snapshotRef}
        readOnlyEvidence={Boolean(selection)}
        evidenceNotice={evidenceNotice}
        commentsController={commentsController}
        onOpenFullFile={handleOpenFullFile}
        onSwitchToConsole={controller.backToConversation}
        onSendReviewAll={handleSendAll}
        onSendReviewComment={handleSendComment}
      />
    </div>
  );
}
