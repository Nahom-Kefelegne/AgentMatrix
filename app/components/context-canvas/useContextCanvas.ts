'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  NAVIGATION_PROTOCOL_VERSION,
  type CanvasMode,
  type CanvasState,
  type NavigationHistoryEntry,
  type NavigationRequest,
  type NavigationTarget,
} from '@/lib/navigation/types';

export interface SessionCanvasState extends CanvasState {
  queuedRequests: NavigationRequest[];
}

export interface ContextCanvasController {
  state: SessionCanvasState;
  isOpen: boolean;
  openRequest: (request: NavigationRequest) => void;
  openFile: (target: NavigationTarget, summary?: string) => void;
  openSearch: (query: string, symbol?: boolean) => void;
  openSessionDiff: () => void;
  close: () => void;
  togglePin: () => void;
  back: () => void;
  forward: () => void;
  showQueued: (requestRef: string) => void;
  backToConversation: () => void;
}

const EMPTY_STATE: SessionCanvasState = {
  mode: 'closed',
  disposition: 'preview',
  request: null,
  history: [],
  historyIndex: -1,
  loading: false,
  error: null,
  queuedRequests: [],
};

// Preserve session-scoped navigation history when Dashboard V2 temporarily
// unmounts for the legacy details dialog or another app view.
const canvasStateCache = new Map<string, SessionCanvasState>();
const MAX_CACHED_SESSIONS = 32;

function modeForRequest(request: NavigationRequest): CanvasMode {
  switch (request.action) {
    case 'show_search_results':
    case 'open_symbol':
      return 'search';
    case 'open_diff':
      return 'diff';
    case 'open_review':
      return 'review';
    default:
      return 'code';
  }
}

function toHistoryEntry(request: NavigationRequest): NavigationHistoryEntry {
  return {
    id: request.requestRef,
    sessionId: request.sessionId,
    action: request.action,
    target: request.target,
    query: request.query,
    diff: request.diff,
    origin: request.intent,
    createdAt: request.createdAt,
  };
}

function requestFromHistory(entry: NavigationHistoryEntry): NavigationRequest {
  return {
    protocolVersion: NAVIGATION_PROTOCOL_VERSION,
    requestRef: entry.id,
    sessionId: entry.sessionId,
    action: entry.action,
    source: 'developer',
    target: entry.target,
    query: entry.query,
    diff: entry.diff,
    presentation: { disposition: 'preview', focus: 'preserve' },
    intent: entry.origin ?? {
      kind: 'explicit_user_request',
      summary: 'Return to navigation history',
    },
    createdAt: entry.createdAt,
  };
}

function newRequestRef(): string {
  return globalThis.crypto?.randomUUID?.() ?? `nav_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function useContextCanvas(
  selectedSessionId: string | null,
  socketRef: React.RefObject<any>,
): ContextCanvasController {
  const [states, setStates] = useState<Map<string, SessionCanvasState>>(() => new Map(canvasStateCache));
  const selectedRef = useRef(selectedSessionId);
  selectedRef.current = selectedSessionId;

  const updateSession = useCallback((
    sessionId: string,
    updater: (state: SessionCanvasState) => SessionCanvasState,
  ) => {
    setStates(previous => {
      const next = new Map(previous);
      const updated = updater(previous.get(sessionId) ?? canvasStateCache.get(sessionId) ?? EMPTY_STATE);
      next.set(sessionId, updated);
      return next;
    });
  }, []);

  useEffect(() => {
    for (const [sessionId, state] of states) {
      canvasStateCache.delete(sessionId);
      canvasStateCache.set(sessionId, state);
    }
    while (canvasStateCache.size > MAX_CACHED_SESSIONS) {
      const oldest = canvasStateCache.keys().next().value as string | undefined;
      if (!oldest) break;
      canvasStateCache.delete(oldest);
    }
  }, [states]);

  const openRequest = useCallback((request: NavigationRequest) => {
    updateSession(request.sessionId, previous => {
      const isSelected = selectedRef.current === request.sessionId;
      const isPinned = previous.mode !== 'closed' && previous.disposition === 'pinned';
      const shouldQueue = !isSelected
        || request.presentation?.disposition === 'queue'
        || (isPinned && request.source !== 'developer' && request.source !== 'terminal_link');

      if (shouldQueue) {
        const queued = previous.queuedRequests.filter(item => item.requestRef !== request.requestRef);
        return { ...previous, queuedRequests: [...queued, request].slice(-20) };
      }

      const historyBase = previous.history.slice(0, previous.historyIndex + 1);
      const historyEntry = toHistoryEntry(request);
      const duplicate = historyBase.at(-1)?.id === historyEntry.id;
      const history = duplicate ? historyBase : [...historyBase, historyEntry].slice(-50);

      return {
        ...previous,
        mode: modeForRequest(request),
        disposition: request.presentation?.disposition === 'pinned' ? 'pinned' : 'preview',
        request,
        history,
        historyIndex: history.length - 1,
        error: null,
        queuedRequests: previous.queuedRequests.filter(item => item.requestRef !== request.requestRef),
      };
    });
  }, [updateSession]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    const handleRequested = (request: NavigationRequest) => openRequest(request);
    socket.on('navigation:requested' as any, handleRequested);
    return () => socket.off('navigation:requested' as any, handleRequested);
  }, [openRequest, socketRef]);

  const createRequest = useCallback((
    action: NavigationRequest['action'],
    extras: Pick<NavigationRequest, 'target' | 'query' | 'diff'>,
    summary: string,
  ) => {
    if (!selectedRef.current) return null;
    return {
      protocolVersion: NAVIGATION_PROTOCOL_VERSION,
      requestRef: newRequestRef(),
      sessionId: selectedRef.current,
      action,
      source: 'developer' as const,
      ...extras,
      presentation: { disposition: 'preview' as const, focus: 'preserve' as const },
      intent: { kind: 'explicit_user_request' as const, summary },
      createdAt: Date.now(),
    } satisfies NavigationRequest;
  }, []);

  const openFile = useCallback((target: NavigationTarget, summary = 'Open code') => {
    const request = createRequest('open_file', { target }, summary);
    if (request) openRequest(request);
  }, [createRequest, openRequest]);

  const openSearch = useCallback((query: string, symbol = false) => {
    const request = createRequest(
      symbol ? 'open_symbol' : 'show_search_results',
      { query },
      symbol ? `Find symbol ${query}` : `Search for ${query}`,
    );
    if (request) openRequest(request);
  }, [createRequest, openRequest]);

  const openSessionDiff = useCallback(() => {
    const request = createRequest(
      'open_review',
      { diff: { source: 'session', sessionId: selectedRef.current ?? undefined, view: 'inline' } },
      'Review this session',
    );
    if (request) openRequest(request);
  }, [createRequest, openRequest]);

  const close = useCallback(() => {
    const sessionId = selectedRef.current;
    if (!sessionId) return;
    updateSession(sessionId, previous => ({ ...previous, mode: 'closed', error: null }));
  }, [updateSession]);

  const togglePin = useCallback(() => {
    const sessionId = selectedRef.current;
    if (!sessionId) return;
    updateSession(sessionId, previous => ({
      ...previous,
      disposition: previous.disposition === 'pinned' ? 'preview' : 'pinned',
    }));
  }, [updateSession]);

  const moveHistory = useCallback((direction: -1 | 1) => {
    const sessionId = selectedRef.current;
    if (!sessionId) return;
    updateSession(sessionId, previous => {
      const nextIndex = previous.historyIndex + direction;
      if (nextIndex < 0 || nextIndex >= previous.history.length) return previous;
      const request = requestFromHistory(previous.history[nextIndex]);
      return {
        ...previous,
        historyIndex: nextIndex,
        request,
        mode: modeForRequest(request),
        error: null,
      };
    });
  }, [updateSession]);

  const showQueued = useCallback((requestRef: string) => {
    const sessionId = selectedRef.current;
    if (!sessionId) return;
    const request = states.get(sessionId)?.queuedRequests.find(item => item.requestRef === requestRef);
    if (request) {
      openRequest({
        ...request,
        source: 'developer',
        presentation: { ...request.presentation, disposition: 'preview', focus: 'preserve' },
      });
    }
  }, [openRequest, states]);

  const backToConversation = useCallback(() => {
    close();
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('.mc-console-stage .xterm-helper-textarea')?.focus();
    });
  }, [close]);

  const state = useMemo(
    () => (selectedSessionId ? states.get(selectedSessionId) ?? EMPTY_STATE : EMPTY_STATE),
    [selectedSessionId, states],
  );

  return {
    state,
    isOpen: state.mode !== 'closed',
    openRequest,
    openFile,
    openSearch,
    openSessionDiff,
    close,
    togglePin,
    back: () => moveHistory(-1),
    forward: () => moveHistory(1),
    showQueued,
    backToConversation,
  };
}
