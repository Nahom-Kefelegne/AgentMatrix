'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FileChange, FileDiff, ReviewComment } from './types';

// Track the last known mouse position at the window level. Used to anchor the
// floating comment popover next to the cursor.
export function useMousePosition() {
  const mousePos = useRef({ x: 0, y: 0 });
  useEffect(() => {
    const handler = (e: MouseEvent) => { mousePos.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener('mousemove', handler);
    return () => window.removeEventListener('mousemove', handler);
  }, []);
  return mousePos;
}

// Fetch the list of changed files for a session and keep it live: re-fetches
// whenever the agent finishes a file-mutating tool (session:files-changed).
// In-flight requests are aborted on refetch/unmount to avoid stale writes.
export function useChangedFiles(
  sessionId: string,
  socketRef: React.RefObject<any>,
  opts: { enabled?: boolean } = {},
) {
  const { enabled = true } = opts;
  const [files, setFiles] = useState<FileChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Increments on every live file-change signal so dependent diffs can refetch.
  const [changeSignal, setChangeSignal] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const reload = useCallback(() => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setError(null);
    fetch(`/api/sessions/changes?sessionId=${sessionId}`, { signal: ctrl.signal })
      .then(r => {
        if (!r.ok) throw new Error(`changes request failed (${r.status})`);
        return r.json();
      })
      .then(data => { setFiles(data.files || []); setLoading(false); })
      .catch(err => {
        if (ctrl.signal.aborted) return;
        console.error('[diff-core] Failed to load changed files:', err);
        setError(err instanceof Error ? err.message : 'Failed to load changes');
        setLoading(false);
      });
  }, [sessionId]);

  useEffect(() => {
    if (!enabled) return;
    reload();
    return () => abortRef.current?.abort();
  }, [enabled, reload]);

  useEffect(() => {
    if (!enabled) return;
    const socket = socketRef.current;
    if (!socket) return;
    const handler = (data: { sessionId: string }) => {
      if (data.sessionId !== sessionId) return;
      reload();
      setChangeSignal(t => t + 1);
    };
    socket.on('session:files-changed' as any, handler);
    return () => { socket.off('session:files-changed' as any, handler); };
  }, [enabled, socketRef, sessionId, reload]);

  return { files, setFiles, loading, error, reload, changeSignal };
}

// Fetch the diff for a single file. Aborts the previous request when the
// selected file changes so a slow earlier response can't overwrite a newer one.
export function useFileDiff(sessionId: string, filePath: string | null, changeSignal: number) {
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!filePath) { setDiff(null); setLoading(false); setError(null); return; }
    const ctrl = new AbortController();
    setLoading(true); setDiff(null); setError(null);
    fetch(`/api/sessions/changes?sessionId=${sessionId}&file=${encodeURIComponent(filePath)}`, { signal: ctrl.signal })
      .then(r => {
        if (!r.ok) throw new Error(`diff request failed (${r.status})`);
        return r.json();
      })
      .then(data => { setDiff(data); setLoading(false); })
      .catch(err => {
        if (ctrl.signal.aborted) return;
        console.error('[diff-core] Failed to load file diff:', err);
        setError(err instanceof Error ? err.message : 'Failed to load diff');
        setDiff(null); setLoading(false);
      });
    return () => ctrl.abort();
  }, [sessionId, filePath, changeSignal]);

  return { diff, loading, error };
}

// Load and mutate review comments for a session. All mutations go through the
// existing /api/sessions/comments endpoint and refresh from its response.
export function useComments(sessionId: string, opts: { enabled?: boolean } = {}) {
  const { enabled = true } = opts;
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    fetch(`/api/sessions/comments?sessionId=${sessionId}`)
      .then(r => {
        if (!r.ok) throw new Error(`comments request failed (${r.status})`);
        return r.json();
      })
      .then(data => setComments(data.comments || []))
      .catch(err => {
        console.error('[diff-core] Failed to load comments:', err);
        setError(err instanceof Error ? err.message : 'Failed to load comments');
      });
  }, [sessionId]);

  useEffect(() => { if (enabled) reload(); }, [enabled, reload]);

  const post = useCallback(async (body: Record<string, unknown>, label: string) => {
    const res = await fetch('/api/sessions/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, ...body }),
    });
    if (!res.ok) throw new Error(`${label} failed (${res.status})`);
    const data = await res.json();
    setComments(data.comments || []);
    return data;
  }, [sessionId]);

  const addComment = useCallback(async (filePath: string, lineNumber: number, text: string) => {
    try {
      await post({ comment: { filePath, lineNumber, text } }, 'add comment');
    } catch (err) {
      console.error('[diff-core] Failed to add comment:', err);
      setError(err instanceof Error ? err.message : 'Failed to add comment');
      throw err;
    }
  }, [post]);

  const deleteComment = useCallback(async (commentId: string) => {
    try {
      const res = await fetch('/api/sessions/comments', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, commentId }),
      });
      if (!res.ok) throw new Error(`delete comment failed (${res.status})`);
      const data = await res.json();
      setComments(data.comments || []);
    } catch (err) {
      console.error('[diff-core] Failed to delete comment:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete comment');
      throw err;
    }
  }, [sessionId]);

  const resolveComment = useCallback(async (commentId: string) => {
    try {
      await post({ action: 'resolve', commentId }, 'resolve comment');
    } catch (err) {
      console.error('[diff-core] Failed to resolve comment:', err);
      setError(err instanceof Error ? err.message : 'Failed to resolve comment');
      throw err;
    }
  }, [post]);

  const resolveAll = useCallback(async () => {
    try {
      await post({ action: 'resolve-all' }, 'resolve all comments');
    } catch (err) {
      console.error('[diff-core] Failed to resolve comments:', err);
      setError(err instanceof Error ? err.message : 'Failed to resolve comments');
      throw err;
    }
  }, [post]);

  return { comments, setComments, reload, addComment, deleteComment, resolveComment, resolveAll, error };
}
