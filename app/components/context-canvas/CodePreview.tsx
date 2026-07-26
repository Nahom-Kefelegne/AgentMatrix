'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState } from 'react';
import type { OnMount } from '@monaco-editor/react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { AGENT_MATRIX_THEME, defineAgentMatrixTheme } from '@/lib/monacoTheme';
import type { NavigationFile, NavigationRequest } from '@/lib/navigation/types';
import { useSocketContext } from '../SocketProvider';

const MonacoEditor = dynamic(
  () => import('@monaco-editor/react').then(module => module.default),
  { ssr: false },
);

const FILE_CACHE_TTL = 30_000;
const FILE_CACHE_MAX = 16;
const fileCache = new Map<string, { timestamp: number; data: NavigationFile }>();

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
  fileCache.delete(key);
  fileCache.set(key, cached);
  return cached.data;
}

function setCachedFile(key: string, data: NavigationFile): void {
  fileCache.delete(key);
  fileCache.set(key, { timestamp: Date.now(), data });
  while (fileCache.size > FILE_CACHE_MAX) {
    const oldest = fileCache.keys().next().value as string | undefined;
    if (!oldest) break;
    fileCache.delete(oldest);
  }
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

export default function CodePreview({ request }: { request: NavigationRequest }) {
  const { socketRef } = useSocketContext();
  const [file, setFile] = useState<NavigationFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    const handleFilesChanged = (payload: { sessionId: string }) => {
      if (payload.sessionId !== request.sessionId) return;
      const prefix = `${request.sessionId}:`;
      for (const key of fileCache.keys()) {
        if (key.startsWith(prefix)) fileCache.delete(key);
      }
      setRevision(value => value + 1);
    };
    socket.on('session:files-changed' as any, handleFilesChanged);
    return () => {
      socket.off('session:files-changed' as any, handleFilesChanged);
    };
  }, [request.sessionId, socketRef]);

  useEffect(() => {
    if (!request.target?.path) {
      setFile(null);
      setLoading(false);
      setError('This navigation request did not include a file path.');
      return;
    }

    const url = fileUrl(request);
    const cacheKey = fileCacheKey(request);
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
        setCachedFile(cacheKey, data);
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
  }, [request, revision]);

  const handleMount: OnMount = useCallback((editor, monaco) => {
    defineAgentMatrixTheme(monaco);
    monaco.editor.setTheme(AGENT_MATRIX_THEME);
    const range = request.target?.range;
    if (!range) return;
    const selection = new monaco.Range(
      range.start.line,
      range.start.column ?? 1,
      range.end?.line ?? range.start.line,
      range.end?.column ?? range.start.column ?? 1,
    );
    editor.setSelection(selection);
    editor.revealRangeInCenter(selection, monaco.editor.ScrollType.Immediate);
  }, [request.target?.range]);

  if (loading) {
    return (
      <div className="cc-loading" role="status">
        <span className="cc-loading-line cc-loading-line--wide" />
        <span className="cc-loading-line" />
        <span className="cc-loading-line cc-loading-line--short" />
        Loading code…
      </div>
    );
  }

  if (error || !file) {
    return (
      <div className="cc-error" role="alert">
        <AlertTriangle size={18} aria-hidden="true" />
        <strong>Could Not Open Code</strong>
        <span>{error || 'The file is unavailable.'}</span>
        <button type="button" onClick={() => setRevision(value => value + 1)}>
          <RefreshCw size={14} aria-hidden="true" /> Retry
        </button>
      </div>
    );
  }

  return (
    <MonacoEditor
      key={`${file.path}:${request.target?.range?.start.line ?? 0}:${request.target?.range?.start.column ?? 0}:${request.target?.range?.end?.line ?? 0}:${request.target?.range?.end?.column ?? 0}`}
      value={file.content}
      language={file.language}
      path={`${file.repoRef}/${file.path}`}
      theme={AGENT_MATRIX_THEME}
      onMount={handleMount}
      loading={<div className="cc-loading" role="status">Loading editor…</div>}
      options={{
        readOnly: true,
        domReadOnly: true,
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 13,
        lineHeight: 21,
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        smoothScrolling: false,
        cursorBlinking: 'solid',
        renderWhitespace: 'selection',
        bracketPairColorization: { enabled: true },
        fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Consolas', monospace",
        fontLigatures: true,
        padding: { top: 10, bottom: 10 },
        wordWrap: 'off',
        folding: true,
        glyphMargin: false,
        contextmenu: true,
        stickyScroll: { enabled: false },
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        overviewRulerBorder: false,
        renderLineHighlight: 'line',
      }}
    />
  );
}
