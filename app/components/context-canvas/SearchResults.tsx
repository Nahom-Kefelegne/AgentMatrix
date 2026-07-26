'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, FileCode2, Search } from 'lucide-react';
import type {
  NavigationRequest,
  NavigationSearchResponse,
  NavigationTarget,
} from '@/lib/navigation/types';
import { useSocketContext } from '../SocketProvider';

const SEARCH_CACHE_TTL = 20_000;
const SEARCH_CACHE_MAX = 32;
const searchCache = new Map<string, { timestamp: number; data: NavigationSearchResponse }>();
const numberFormat = new Intl.NumberFormat();

interface SearchResultsProps {
  request: NavigationRequest;
  onOpenFile: (target: NavigationTarget, summary?: string) => void;
}

function getCachedSearch(key: string): NavigationSearchResponse | null {
  const now = Date.now();
  for (const [cacheKey, entry] of searchCache) {
    if (now - entry.timestamp >= SEARCH_CACHE_TTL) searchCache.delete(cacheKey);
  }
  const cached = searchCache.get(key);
  if (!cached) return null;
  searchCache.delete(key);
  searchCache.set(key, cached);
  return cached.data;
}

function setCachedSearch(key: string, data: NavigationSearchResponse): void {
  searchCache.delete(key);
  searchCache.set(key, { timestamp: Date.now(), data });
  while (searchCache.size > SEARCH_CACHE_MAX) {
    const oldest = searchCache.keys().next().value as string | undefined;
    if (!oldest) break;
    searchCache.delete(oldest);
  }
}

export default function SearchResults({ request, onOpenFile }: SearchResultsProps) {
  const { socketRef } = useSocketContext();
  const [query, setQuery] = useState(request.query ?? request.target?.symbol ?? '');
  const deferredQuery = useDeferredValue(query.trim());
  const [data, setData] = useState<NavigationSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    setQuery(request.query ?? request.target?.symbol ?? '');
  }, [request.query, request.target?.symbol]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    const handleFilesChanged = (payload: { sessionId: string }) => {
      if (payload.sessionId !== request.sessionId) return;
      const prefix = `${request.sessionId}:`;
      for (const key of searchCache.keys()) {
        if (key.startsWith(prefix)) searchCache.delete(key);
      }
      setRevision(value => value + 1);
    };
    socket.on('session:files-changed' as any, handleFilesChanged);
    return () => {
      socket.off('session:files-changed' as any, handleFilesChanged);
    };
  }, [request.sessionId, socketRef]);

  const mode = request.action === 'open_symbol' ? 'symbol' : 'content';
  const cacheKey = useMemo(
    () => `${request.sessionId}:${mode}:${deferredQuery}`,
    [deferredQuery, mode, request.sessionId],
  );

  useEffect(() => {
    if (deferredQuery.length < 2) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    const cached = getCachedSearch(cacheKey);
    if (cached) {
      setData(cached);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      fetch('/api/navigation/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: request.sessionId,
          query: deferredQuery,
          mode,
          stream: true,
        }),
        signal: controller.signal,
      })
        .then(async response => {
          if (!response.ok) {
            const body = await response.json().catch(() => null);
            throw new Error(body?.error?.message || body?.error || 'Search failed.');
          }
          if (!response.body) throw new Error('Search stream was unavailable.');
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffered = '';
          let accumulated: NavigationSearchResponse = {
            sessionId: request.sessionId,
            repoRef: '',
            query: deferredQuery,
            matches: [],
            truncated: false,
            indexVersion: '',
            durationMs: 0,
          };
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffered += decoder.decode(value, { stream: true });
            let newline = buffered.indexOf('\n');
            while (newline >= 0) {
              const line = buffered.slice(0, newline);
              buffered = buffered.slice(newline + 1);
              newline = buffered.indexOf('\n');
              if (!line) continue;
              const event = JSON.parse(line) as {
                type: 'batch' | 'done' | 'error';
                matches?: NavigationSearchResponse['matches'];
                result?: NavigationSearchResponse;
                error?: { message?: string };
              };
              if (event.type === 'error') throw new Error(event.error?.message || 'Search failed.');
              if (event.type === 'batch' && event.matches) {
                accumulated = { ...accumulated, matches: [...accumulated.matches, ...event.matches] };
                setData(accumulated);
              }
              if (event.type === 'done' && event.result) {
                accumulated = { ...event.result, matches: accumulated.matches };
                setCachedSearch(cacheKey, accumulated);
                setData(accumulated);
                setLoading(false);
              }
            }
          }
          return accumulated;
        })
        .catch(reason => {
          if (controller.signal.aborted) return;
          setData(null);
          setLoading(false);
          setError(reason instanceof Error ? reason.message : 'Search failed.');
        });
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [cacheKey, deferredQuery, mode, request.sessionId, revision]);

  return (
    <div className="cc-search">
      <label className="cc-search-input">
        <Search size={15} aria-hidden="true" />
        <span className="sr-only">Search repository</span>
        <input
          type="search"
          name="context-canvas-search"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder={mode === 'symbol' ? 'Find symbol…' : 'Search repository…'}
        />
        {loading ? <span className="cc-search-status" role="status" aria-live="polite">Searching…</span> : null}
      </label>

      {error ? (
        <div className="cc-inline-error" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      {!error && !loading && deferredQuery.length < 2 ? (
        <div className="cc-empty">
          <Search size={23} aria-hidden="true" />
          <strong>Search This Session’s Repository</strong>
          <span>Enter at least 2 characters.</span>
        </div>
      ) : null}

      {!error && data && data.matches.length === 0 ? (
        <div className="cc-empty">
          <Search size={23} aria-hidden="true" />
          <strong>No Matches</strong>
          <span>Try a symbol, error text, or a more specific phrase.</span>
        </div>
      ) : null}

      {data?.matches.length ? (
        <>
          <div className="cc-results-meta">
            <span>{numberFormat.format(data.matches.length)} results</span>
            <span>{numberFormat.format(data.durationMs)}ms{data.truncated ? ' · truncated' : ''}</span>
          </div>
          <div className="cc-results" role="list">
            {data.matches.map((match, index) => (
              <button
                key={`${match.path}:${match.line}:${match.column ?? 0}:${index}`}
                type="button"
                className="cc-result"
                onClick={() => onOpenFile({
                  path: match.path,
                  range: {
                    start: { line: match.line, column: match.column ?? 1 },
                    end: { line: match.line, column: (match.column ?? 1) + Math.max(1, match.matchText?.length ?? 1) },
                  },
                }, `Open ${match.path}:${match.line}`)}
              >
                <FileCode2 size={15} aria-hidden="true" />
                <span className="cc-result-copy">
                  <span className="cc-result-path">{match.path}:{match.line}</span>
                  <span className="cc-result-preview">{match.preview}</span>
                </span>
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
