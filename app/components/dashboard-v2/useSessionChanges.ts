'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FileChange } from '@/lib/cli/transcript/types';
import type { ChangeSummary, ChangeSummaryState } from './types';

const CHANGE_CACHE_TTL = 15_000;
const changeCache = new Map<string, { data: ChangeSummary; timestamp: number }>();

interface ChangeListResponse {
  files?: FileChange[];
  error?: string;
}

function summarize(files: FileChange[]): ChangeSummary {
  let totalAdditions = 0;
  let totalDeletions = 0;
  for (const file of files) {
    totalAdditions += file.additions;
    totalDeletions += file.deletions;
  }
  return { files, totalAdditions, totalDeletions };
}

export function useSessionChanges(
  sessionId: string | null,
  socketRef: React.RefObject<any>,
): ChangeSummaryState {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<ChangeSummaryState>({
    data: null,
    loading: false,
    error: null,
  });

  const invalidate = useCallback((id: string) => {
    changeCache.delete(id);
    setRevision(value => value + 1);
  }, []);

  useEffect(() => {
    if (!sessionId) {
      setState({ data: null, loading: false, error: null });
      return;
    }

    const cached = changeCache.get(sessionId);
    if (cached && Date.now() - cached.timestamp < CHANGE_CACHE_TTL) {
      setState({ data: cached.data, loading: false, error: null });
      return;
    }

    const controller = new AbortController();
    setState({ data: null, loading: true, error: null });

    fetch(`/api/sessions/changes?sessionId=${encodeURIComponent(sessionId)}`, {
      signal: controller.signal,
    })
      .then(async response => {
        const payload = await response.json() as ChangeListResponse;
        if (!response.ok) throw new Error(payload.error || 'Could not load this session\'s changes.');
        return summarize(payload.files ?? []);
      })
      .then(data => {
        changeCache.set(sessionId, { data, timestamp: Date.now() });
        setState({ data, loading: false, error: null });
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        const reason = error instanceof Error ? error.message : 'Could not load this session\'s changes.';
        setState({
          data: null,
          loading: false,
          error: `${reason} Open the session and try again.`,
        });
      });

    return () => controller.abort();
  }, [sessionId, revision]);

  useEffect(() => {
    if (!sessionId) return;
    const socket = socketRef.current;
    if (!socket) return;
    const handleFilesChanged = (payload: { sessionId: string }) => {
      if (payload.sessionId === sessionId) invalidate(sessionId);
    };
    socket.on('session:files-changed' as any, handleFilesChanged);
    return () => socket.off('session:files-changed' as any, handleFilesChanged);
  }, [invalidate, sessionId, socketRef]);

  return state;
}
