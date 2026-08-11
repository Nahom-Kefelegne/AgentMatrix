'use client';

import { useEffect, useState } from 'react';
import type { NavigationFile, NavigationRequest } from '@/lib/navigation/types';
import { useSocketContext } from '../SocketProvider';

const FILE_CACHE_TTL = 30_000;
const FILE_CACHE_MAX = 24;
const fileCache = new Map<string, { timestamp: number; generation: number; data: NavigationFile }>();
const fileGenerations = new Map<string, number>();
const lastRequestRefByKey = new Map<string, string>();

export interface NavigationFileState {
  file: NavigationFile | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

interface UseNavigationFileOptions {
  invalidateOnRequestChange?: boolean;
}

export interface NavigationFilesChangedPayload {
  sessionId: string;
  changes?: Array<{ path?: string }>;
}

function fileCacheKey(request: NavigationRequest): string {
  return `${request.sessionId}:${request.target?.path ?? ''}`;
}

function getCachedFile(key: string): NavigationFile | null {
  const now = Date.now();
  for (const [cacheKey, entry] of fileCache) {
    if (now - entry.timestamp >= FILE_CACHE_TTL) fileCache.delete(cacheKey);
  }
  const cached = fileCache.get(key);
  if (!cached) return null;
  if (cached.generation !== (fileGenerations.get(key) ?? 0)) {
    fileCache.delete(key);
    return null;
  }
  fileCache.delete(key);
  fileCache.set(key, cached);
  return cached.data;
}

function setCachedFile(key: string, generation: number, data: NavigationFile): void {
  if ((fileGenerations.get(key) ?? 0) !== generation) return;
  fileCache.delete(key);
  fileCache.set(key, { timestamp: Date.now(), generation, data });
  while (fileCache.size > FILE_CACHE_MAX) {
    const oldest = fileCache.keys().next().value as string | undefined;
    if (!oldest) break;
    fileCache.delete(oldest);
  }
}

function invalidateFile(key: string): void {
  fileGenerations.set(key, (fileGenerations.get(key) ?? 0) + 1);
  fileCache.delete(key);
}

function invalidateSessionFiles(sessionId: string): void {
  const prefix = `${sessionId}:`;
  const keys = new Set([...fileCache.keys(), ...fileGenerations.keys()]);
  for (const key of keys) {
    if (key.startsWith(prefix)) invalidateFile(key);
  }
}

export function invalidateNavigationFileEvent(payload: NavigationFilesChangedPayload): void {
  if (payload.changes?.length) {
    for (const change of payload.changes) {
      if (change.path) invalidateFile(`${payload.sessionId}:${change.path}`);
    }
    return;
  }
  invalidateSessionFiles(payload.sessionId);
}

function fileUrl(request: NavigationRequest): string {
  const target = request.target;
  const params = new URLSearchParams({
    sessionId: request.sessionId,
    path: target?.path ?? '',
  });
  if (target?.range?.start.line) params.set('startLine', String(target.range.start.line));
  if (target?.range?.start.column) params.set('startColumn', String(target.range.start.column));
  if (target?.range?.end?.line) params.set('endLine', String(target.range.end.line));
  if (target?.range?.end?.column) params.set('endColumn', String(target.range.end.column));
  return `/api/navigation/file?${params.toString()}`;
}

export function useNavigationFile(
  request: NavigationRequest,
  options: UseNavigationFileOptions = {},
): NavigationFileState {
  const { socketRef } = useSocketContext();
  const { invalidateOnRequestChange = true } = options;
  const [file, setFile] = useState<NavigationFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    const handleFilesChanged = (payload: NavigationFilesChangedPayload) => {
      if (payload.sessionId !== request.sessionId) return;
      const currentPath = request.target?.path;
      if (payload.changes?.length && !payload.changes.some(change => change.path === currentPath)) return;

      setRevision(value => value + 1);
    };
    socket.on('session:files-changed' as any, handleFilesChanged);
    return () => {
      socket.off('session:files-changed' as any, handleFilesChanged);
    };
  }, [request, socketRef]);

  useEffect(() => {
    if (!request.target?.path) {
      setFile(null);
      setLoading(false);
      setError('This navigation request did not include a file path.');
      return;
    }

    const url = fileUrl(request);
    const cacheKey = fileCacheKey(request);
    const previousRequestRef = lastRequestRefByKey.get(cacheKey);
    if (
      invalidateOnRequestChange
      && previousRequestRef
      && previousRequestRef !== request.requestRef
    ) {
      invalidateFile(cacheKey);
    }
    lastRequestRefByKey.set(cacheKey, request.requestRef);
    const generation = fileGenerations.get(cacheKey) ?? 0;
    const cached = getCachedFile(cacheKey);
    if (cached) {
      setFile(cached);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch(url, { signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.error?.message || data?.error || 'Could not open this file.');
        }
        return data as NavigationFile;
      })
      .then(data => {
        if ((fileGenerations.get(cacheKey) ?? 0) !== generation) return;
        setCachedFile(cacheKey, generation, data);
        setFile(data);
        setLoading(false);
      })
      .catch(reason => {
        if (controller.signal.aborted) return;
        setFile(null);
        setLoading(false);
        setError(reason instanceof Error ? reason.message : 'Could not open this file.');
      });
    return () => controller.abort();
  }, [invalidateOnRequestChange, request, revision]);

  return {
    file,
    loading,
    error,
    retry: () => {
      invalidateFile(fileCacheKey(request));
      setRevision(value => value + 1);
    },
  };
}
