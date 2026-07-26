'use client';

import { useCallback, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { ReviewComment, ReviewSendMode, CommentAnchor } from '../diff-core';
import { SessionDiffCore, useComments } from '../diff-core';
import { useSocketContext } from '../SocketProvider';
import type { NavigationRequest } from '@/lib/navigation/types';
import type { ContextCanvasController } from './useContextCanvas';

interface DiffCanvasProps {
  sessionId: string;
  sessionName: string;
  cwd?: string;
  request: NavigationRequest;
  controller: ContextCanvasController;
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
  controller,
}: DiffCanvasProps) {
  const { socketRef } = useSocketContext();
  const commentsController = useComments(sessionId);
  const [sendError, setSendError] = useState<string | null>(null);

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
    }, `Open ${anchor.filePath}`);
  }, [controller, cwd]);

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
        initialPath={request.target?.path ?? request.diff?.filterPaths?.[0]}
        commentsController={commentsController}
        onOpenFullFile={handleOpenFullFile}
        onSwitchToConsole={controller.backToConversation}
        onSendReviewAll={handleSendAll}
        onSendReviewComment={handleSendComment}
      />
    </div>
  );
}
