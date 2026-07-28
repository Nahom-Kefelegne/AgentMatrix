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
import { isMarkdownPath } from './markdown';
import type { SessionFilesChangedEvent } from '@/lib/types';
import { invalidateNavigationFileEvent } from './useNavigationFile';

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
      return isMarkdownPath(request.target?.path) ? 'document' : 'code';
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
  const statesRef = useRef(states);
  statesRef.current = states;
  const selectedRef = useRef(selectedSessionId);
  selectedRef.current = selectedSessionId;
  const autoPreviewTimersRef = useRef<Map<string, number>>(new Map());

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
        || (isPinned && request.source !== 'developer' && request.source !== 'terminal_link')
        || (
          request.source === 'session_event'
          && previous.mode !== 'closed'
          && previous.request?.source !== 'session_event'
          && previous.request?.target?.path !== request.target?.path
        );

      if (shouldQueue) {
        const queued = previous.queuedRequests.filter(item =>
          item.requestRef !== request.requestRef
          && !(
            request.source === 'session_event'
            && item.source === 'session_event'
            && item.target?.path === request.target?.path
          ),
        );
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

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    const handleFilesChanged = (event: SessionFilesChangedEvent) => {
      invalidateNavigationFileEvent(event);
      const candidates = event.changes?.filter(change =>
        change.op !== 'delete'
        && isMarkdownPath(change.path)
        && /(?:^|\/)docs\/design\//.test(change.path.toLocaleLowerCase()),
      );
      const candidate = candidates?.at(-1);
      if (!candidate) return;

      const currentState = statesRef.current.get(event.sessionId) ?? canvasStateCache.get(event.sessionId) ?? EMPTY_STATE;
      const existingTimer = autoPreviewTimersRef.current.get(event.sessionId);
      if (
        currentState.mode === 'document'
        && currentState.request?.target?.path === candidate.path
      ) {
        if (existingTimer !== undefined) {
          window.clearTimeout(existingTimer);
          autoPreviewTimersRef.current.delete(event.sessionId);
        }
        return;
      }

      if (existingTimer !== undefined) window.clearTimeout(existingTimer);
      const timer = window.setTimeout(() => {
        autoPreviewTimersRef.current.delete(event.sessionId);
        const latest = statesRef.current.get(event.sessionId) ?? canvasStateCache.get(event.sessionId) ?? EMPTY_STATE;
        if (
          latest.mode === 'document'
          && latest.request?.target?.path === candidate.path
        ) {
          return;
        }
        const protectedArtifact = latest.mode !== 'closed'
          && latest.request?.source !== 'session_event'
          && latest.request?.target?.path !== candidate.path;
        const disposition = latest.disposition === 'pinned' || protectedArtifact
          ? 'queue'
          : 'preview';
        openRequest({
          protocolVersion: NAVIGATION_PROTOCOL_VERSION,
          requestRef: newRequestRef(),
          sessionId: event.sessionId,
          action: 'open_file',
          source: 'session_event',
          target: { path: candidate.path },
          presentation: { disposition, focus: 'preserve' },
          intent: {
            kind: 'agent_progress',
            summary: candidate.op === 'create'
              ? `Created design document ${candidate.path}`
              : `Updated design document ${candidate.path}`,
          },
          createdAt: event.completedAt || Date.now(),
        });
      }, 800);
      autoPreviewTimersRef.current.set(event.sessionId, timer);
    };

    socket.on('session:files-changed' as any, handleFilesChanged);
    return () => {
      socket.off('session:files-changed' as any, handleFilesChanged);
      for (const timer of autoPreviewTimersRef.current.values()) window.clearTimeout(timer);
      autoPreviewTimersRef.current.clear();
    };
  }, [openRequest, socketRef]);

  useEffect(() => {
    if (!selectedSessionId) return;
    const selectedState = statesRef.current.get(selectedSessionId)
      ?? canvasStateCache.get(selectedSessionId)
      ?? EMPTY_STATE;
    if (selectedState.mode !== 'closed') return;
    const queued = selectedState.queuedRequests[0];
    if (!queued) return;

    openRequest({
      ...queued,
      presentation: {
        ...queued.presentation,
        disposition: 'preview',
        focus: 'preserve',
      },
    });
  }, [openRequest, selectedSessionId]);

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
