'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type {
  CanvasRequest,
  DecisionCanvasRequest,
} from '@/lib/canvas/types';
import {
  isRepositorySearchAction,
  NAVIGATION_PROTOCOL_VERSION,
  type NavigationDisposition,
  type NavigationRequest,
  type NavigationTarget,
} from '@/lib/navigation/types';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  SessionData,
  SessionFilesChangedEvent,
} from '@/lib/types';
import {
  artifactCreatedAt,
  artifactDisposition,
  artifactId,
  artifactIsAgentOwned,
  artifactIsRenderable,
  artifactSessionId,
  type CanvasArtifact,
} from './canvasArtifact';
import { isMarkdownPath } from './markdown';
import { invalidateNavigationFileEvent } from './useNavigationFile';

export interface SessionCanvasState {
  visible: boolean;
  activeArtifact: CanvasArtifact | null;
  disposition: NavigationDisposition;
  history: CanvasArtifact[];
  historyIndex: number;
  queuedArtifacts: CanvasArtifact[];
  closedAt: number;
}

export interface ContextCanvasController {
  state: SessionCanvasState;
  isOpen: boolean;
  openRequest: (request: NavigationRequest) => void;
  openCanvasRequest: (request: CanvasRequest) => void;
  openFile: (target: NavigationTarget, summary?: string) => void;
  openCode: (target: NavigationTarget, summary?: string) => void;
  openCanvas: () => void;
  openSessionDiff: () => void;
  resolveDecision: (request: DecisionCanvasRequest) => void;
  close: () => void;
  togglePin: () => void;
  back: () => void;
  forward: () => void;
  showQueued: (requestRef: string) => void;
  backToConversation: () => void;
}

const EMPTY_STATE: SessionCanvasState = {
  visible: false,
  activeArtifact: null,
  disposition: 'preview',
  history: [],
  historyIndex: -1,
  queuedArtifacts: [],
  closedAt: 0,
};

// Preserve session-scoped Canvas state when Dashboard V2 temporarily unmounts.
const canvasStateCache = new Map<string, SessionCanvasState>();
const MAX_CACHED_SESSIONS = 64;
const MAX_HISTORY = 50;
const MAX_QUEUE = 50;
const MAX_QUEUE_BYTES = 1024 * 1024;
const REPLACING_TYPED_KINDS = new Set(['code', 'changes', 'plan', 'decision']);
const textEncoder = new TextEncoder();

function newRequestRef(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `nav_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function containsArtifact(state: SessionCanvasState, requestRef: string): boolean {
  return state.activeArtifact?.request.requestRef === requestRef
    || state.history.some(artifact => artifactId(artifact) === requestRef)
    || state.queuedArtifacts.some(artifact => artifactId(artifact) === requestRef);
}

function replaceDecisionArtifact(
  artifact: CanvasArtifact,
  request: DecisionCanvasRequest,
): CanvasArtifact {
  return artifact.type === 'typed'
    && artifact.request.kind === 'decision'
    && artifact.request.requestRef === request.requestRef
    ? { type: 'typed', request }
    : artifact;
}

export function applyCanvasDecisionResolution(
  state: SessionCanvasState,
  request: DecisionCanvasRequest,
): SessionCanvasState {
  let changed = false;
  const replace = (artifact: CanvasArtifact): CanvasArtifact => {
    const next = replaceDecisionArtifact(artifact, request);
    if (next !== artifact) changed = true;
    return next;
  };
  const activeArtifact = state.activeArtifact
    ? replace(state.activeArtifact)
    : null;
  const history = state.history.map(replace);
  const queuedArtifacts = state.queuedArtifacts.map(replace);
  return changed
    ? { ...state, activeArtifact, history, queuedArtifacts }
    : state;
}

function latestStateTimestamp(state: SessionCanvasState): number {
  return Math.max(
    state.activeArtifact ? artifactCreatedAt(state.activeArtifact) : 0,
    ...state.history.map(artifactCreatedAt),
    ...state.queuedArtifacts.map(artifactCreatedAt),
  );
}

function hasNewerTypedKind(
  state: SessionCanvasState,
  request: CanvasRequest,
): boolean {
  const artifacts = [
    ...(state.activeArtifact ? [state.activeArtifact] : []),
    ...state.history,
    ...state.queuedArtifacts,
  ];
  return artifacts.some(artifact =>
    artifact.type === 'typed'
    && artifact.request.kind === request.kind
    && artifact.request.createdAt >= request.createdAt,
  );
}

function artifactBytes(artifact: CanvasArtifact): number {
  return textEncoder.encode(JSON.stringify(artifact)).byteLength;
}

function trimArtifactQueue(artifacts: CanvasArtifact[]): CanvasArtifact[] {
  const retained = artifacts.slice(-MAX_QUEUE);
  let bytes = retained.reduce((total, artifact) => total + artifactBytes(artifact), 0);
  while (bytes > MAX_QUEUE_BYTES && retained.length > 1) {
    bytes -= artifactBytes(retained.shift()!);
  }
  return retained;
}

function queueArtifact(
  state: SessionCanvasState,
  artifact: CanvasArtifact,
  showCanvas: boolean,
): SessionCanvasState {
  const requestRef = artifactId(artifact);
  let queued = state.queuedArtifacts.filter(item => artifactId(item) !== requestRef);

  if (
    artifact.type === 'navigation'
    && artifact.request.source === 'session_event'
    && artifact.request.target?.path
  ) {
    queued = queued.filter(item =>
      item.type !== 'navigation'
      || item.request.source !== 'session_event'
      || item.request.target?.path !== artifact.request.target?.path,
    );
  }

  if (
    artifact.type === 'typed'
    && REPLACING_TYPED_KINDS.has(artifact.request.kind)
  ) {
    queued = queued.filter(item =>
      item.type !== 'typed' || item.request.kind !== artifact.request.kind,
    );
  }

  return {
    ...state,
    visible: state.visible || showCanvas,
    queuedArtifacts: trimArtifactQueue([...queued, artifact]),
  };
}

function activateArtifact(
  state: SessionCanvasState,
  artifact: CanvasArtifact,
): SessionCanvasState {
  const requestRef = artifactId(artifact);
  const historyBase = state.history.slice(0, state.historyIndex + 1);
  const duplicate = historyBase.at(-1)
    && artifactId(historyBase.at(-1)!) === requestRef;
  const history = duplicate
    ? historyBase
    : [...historyBase, artifact].slice(-MAX_HISTORY);

  return {
    ...state,
    visible: true,
    activeArtifact: artifact,
    disposition: artifactDisposition(artifact) === 'pinned' ? 'pinned' : 'preview',
    history,
    historyIndex: history.length - 1,
    queuedArtifacts: state.queuedArtifacts.filter(item => artifactId(item) !== requestRef),
    closedAt: 0,
  };
}

function replaceActivePlan(
  state: SessionCanvasState,
  artifact: CanvasArtifact,
): SessionCanvasState {
  const history = [...state.history];
  let historyIndex = state.historyIndex;
  if (historyIndex >= 0 && historyIndex < history.length) {
    history[historyIndex] = artifact;
  } else {
    history.push(artifact);
    historyIndex = history.length - 1;
  }
  return {
    ...state,
    visible: true,
    activeArtifact: artifact,
    history,
    historyIndex,
    queuedArtifacts: state.queuedArtifacts.filter(item =>
      item.type !== 'typed' || item.request.kind !== 'plan'),
    closedAt: 0,
  };
}

function activateOrReplaceArtifact(
  state: SessionCanvasState,
  artifact: CanvasArtifact,
): SessionCanvasState {
  if (
    artifact.type === 'typed'
    && artifact.request.kind === 'plan'
    && state.activeArtifact?.type === 'typed'
    && state.activeArtifact.request.kind === 'plan'
  ) {
    return replaceActivePlan(state, artifact);
  }
  return activateArtifact(state, artifact);
}

export function closeCanvasState(
  state: SessionCanvasState,
  closedAt = Date.now(),
): SessionCanvasState {
  if (!state.visible && !state.activeArtifact && state.disposition === 'preview') return state;
  return {
    ...state,
    visible: false,
    activeArtifact: null,
    disposition: 'preview',
    closedAt,
  };
}

export function toggleCanvasPinState(state: SessionCanvasState): SessionCanvasState {
  if (!state.activeArtifact) return state;
  return {
    ...state,
    disposition: state.disposition === 'pinned' ? 'preview' : 'pinned',
  };
}

export function moveCanvasHistory(
  state: SessionCanvasState,
  direction: -1 | 1,
): SessionCanvasState {
  const nextIndex = state.historyIndex + direction;
  if (nextIndex < 0 || nextIndex >= state.history.length) return state;
  return {
    ...state,
    visible: true,
    activeArtifact: state.history[nextIndex],
    disposition: 'preview',
    historyIndex: nextIndex,
    closedAt: 0,
  };
}

export function activateQueuedCanvasArtifact(
  state: SessionCanvasState,
  requestRef: string,
): SessionCanvasState {
  const artifact = state.queuedArtifacts.find(item => artifactId(item) === requestRef);
  if (!artifact || !artifactIsRenderable(artifact)) return state;
  return activateOrReplaceArtifact(state, artifact);
}

export function restoreCanvasOnSessionSelection(
  state: SessionCanvasState,
): SessionCanvasState {
  const active = state.activeArtifact;
  if (
    active
    && (
      state.disposition === 'pinned'
      || !artifactIsAgentOwned(active)
    )
  ) {
    return state;
  }
  const minimumCreatedAt = Math.max(
    state.closedAt,
    active ? artifactCreatedAt(active) : 0,
  );
  const eligible = state.queuedArtifacts.filter(
    artifact => artifactCreatedAt(artifact) > minimumCreatedAt,
  );
  if (eligible.length === 0) {
    if (state.visible || active) return state;
    return state;
  }
  const queued = eligible.find(artifactIsRenderable);
  return queued
    ? activateOrReplaceArtifact(state, queued)
    : { ...state, visible: true };
}

export function reduceCanvasArtifact(
  state: SessionCanvasState,
  artifact: CanvasArtifact,
  selectedSessionId: string | null,
): SessionCanvasState {
  const requestRef = artifactId(artifact);
  if (containsArtifact(state, requestRef)) return state;

  const isSelected = selectedSessionId === artifactSessionId(artifact);
  const isPinned = state.activeArtifact !== null && state.disposition === 'pinned';
  const navigation = artifact.type === 'navigation' ? artifact.request : null;
  const protectsAutomaticPreview = navigation?.source === 'session_event'
    && state.activeArtifact?.type === 'navigation'
    && state.activeArtifact.request.source !== 'session_event'
    && state.activeArtifact.request.target?.path !== navigation.target?.path;
  const protectsHumanArtifact = state.activeArtifact?.type === 'navigation'
    && (
      state.activeArtifact.request.source === 'developer'
      || state.activeArtifact.request.source === 'terminal_link'
    )
    && artifactIsAgentOwned(artifact);
  const predatesExplicitClose = state.activeArtifact === null
    && artifactCreatedAt(artifact) <= (state.closedAt ?? 0);

  const shouldQueue = !artifactIsRenderable(artifact)
    || !isSelected
    || artifactDisposition(artifact) === 'queue'
    || (isPinned && artifactIsAgentOwned(artifact))
    || protectsAutomaticPreview
    || protectsHumanArtifact
    || predatesExplicitClose;

  const showQueuedCanvas = isSelected
    && !predatesExplicitClose
    && artifactDisposition(artifact) !== 'queue';

  if (shouldQueue) {
    return queueArtifact(state, artifact, showQueuedCanvas);
  }
  return activateOrReplaceArtifact(state, artifact);
}

export function hydrateCanvasSnapshot(
  states: ReadonlyMap<string, SessionCanvasState>,
  requests: readonly CanvasRequest[],
  selectedSessionId: string | null,
  fallbackStates: ReadonlyMap<string, SessionCanvasState> = new Map(),
): Map<string, SessionCanvasState> {
  let next: Map<string, SessionCanvasState> | null = null;
  const ordered = requests.toSorted((left, right) => left.createdAt - right.createdAt);

  for (const request of ordered) {
    const source = next ?? states;
    const current = source.get(request.sessionId)
      ?? fallbackStates.get(request.sessionId)
      ?? EMPTY_STATE;
    if (containsArtifact(current, request.requestRef)) {
      if (request.kind === 'decision' && request.payload.resolution) {
        const resolved = applyCanvasDecisionResolution(current, request);
        if (resolved !== current) {
          next ??= new Map(states);
          next.set(request.sessionId, resolved);
        }
      }
      continue;
    }
    const artifact: CanvasArtifact = { type: 'typed', request };
    const predatesLocalState = request.createdAt <= latestStateTimestamp(current);
    if (
      predatesLocalState
      && REPLACING_TYPED_KINDS.has(request.kind)
      && hasNewerTypedKind(current, request)
    ) {
      continue;
    }
    next ??= new Map(states);
    next.set(
      request.sessionId,
      predatesLocalState
        ? queueArtifact(current, artifact, false)
        : reduceCanvasArtifact(current, artifact, selectedSessionId),
    );
  }

  return next ?? (states instanceof Map ? states : new Map(states));
}

export function useContextCanvas(
  selectedSessionId: string | null,
  socketRef: React.RefObject<
    Socket<ServerToClientEvents, ClientToServerEvents> | null
  >,
  connected: boolean,
  activeSessions: ReadonlyMap<string, SessionData>,
): ContextCanvasController {
  const [states, setStates] = useState<Map<string, SessionCanvasState>>(
    () => new Map(canvasStateCache),
  );
  const statesRef = useRef(states);
  statesRef.current = states;
  const selectedRef = useRef(selectedSessionId);
  selectedRef.current = selectedSessionId;
  const autoPreviewTimersRef = useRef<Map<string, number>>(new Map());
  const seenActiveSessionIdsRef = useRef<Set<string>>(
    new Set(activeSessions.keys()),
  );

  const updateSession = useCallback((
    sessionId: string,
    updater: (state: SessionCanvasState) => SessionCanvasState,
  ) => {
    setStates(previous => {
      const next = new Map(previous);
      const current = previous.get(sessionId)
        ?? canvasStateCache.get(sessionId)
        ?? EMPTY_STATE;
      next.set(sessionId, updater(current));
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

  const openArtifact = useCallback((artifact: CanvasArtifact) => {
    updateSession(artifactSessionId(artifact), previous =>
      reduceCanvasArtifact(previous, artifact, selectedRef.current));
  }, [updateSession]);

  const openRequest = useCallback((request: NavigationRequest) => {
    if (isRepositorySearchAction(request.action)) {
      console.warn(`[context-canvas] Ignored disabled ${request.action} request ${request.requestRef}.`);
      return;
    }
    openArtifact({ type: 'navigation', request });
  }, [openArtifact]);

  const openCanvasRequest = useCallback((request: CanvasRequest) => {
    openArtifact({ type: 'typed', request });
  }, [openArtifact]);

  const resolveDecision = useCallback((request: DecisionCanvasRequest) => {
    updateSession(
      request.sessionId,
      previous => applyCanvasDecisionResolution(previous, request),
    );
  }, [updateSession]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !connected) return;
    const handleNavigation = (request: NavigationRequest) => openRequest(request);
    const handleCanvas = (request: CanvasRequest) => openCanvasRequest(request);
    const handleDecisionResolved = (request: DecisionCanvasRequest) => resolveDecision(request);
    socket.on('navigation:requested', handleNavigation);
    socket.on('canvas:requested', handleCanvas);
    socket.on('canvas:decision-resolved', handleDecisionResolved);
    return () => {
      socket.off('navigation:requested', handleNavigation);
      socket.off('canvas:requested', handleCanvas);
      socket.off('canvas:decision-resolved', handleDecisionResolved);
    };
  }, [connected, openCanvasRequest, openRequest, resolveDecision, socketRef]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !connected) return;
    const handleSnapshot = (requests: CanvasRequest[]) => {
      setStates(previous => hydrateCanvasSnapshot(
        previous,
        requests,
        selectedRef.current,
        canvasStateCache,
      ));
    };
    socket.on('canvas:snapshot', handleSnapshot);
    socket.emit('canvas:get-snapshot');
    return () => {
      socket.off('canvas:snapshot', handleSnapshot);
    };
  }, [connected, socketRef]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !connected) return;
    const handleSessionEnd = ({ sessionId }: { sessionId: string }) => {
      seenActiveSessionIdsRef.current.delete(sessionId);
      canvasStateCache.delete(sessionId);
      const timer = autoPreviewTimersRef.current.get(sessionId);
      if (timer !== undefined) {
        window.clearTimeout(timer);
        autoPreviewTimersRef.current.delete(sessionId);
      }
      setStates(previous => {
        if (!previous.has(sessionId)) return previous;
        const next = new Map(previous);
        next.delete(sessionId);
        return next;
      });
    };
    socket.on('session:end', handleSessionEnd);
    return () => {
      socket.off('session:end', handleSessionEnd);
    };
  }, [connected, socketRef]);

  useEffect(() => {
    const activeIds = new Set(activeSessions.keys());
    const seenActiveIds = seenActiveSessionIdsRef.current;
    const removedIds = new Set(
      Array.from(seenActiveIds).filter(sessionId => !activeIds.has(sessionId)),
    );
    for (const sessionId of activeIds) seenActiveIds.add(sessionId);
    for (const sessionId of removedIds) {
      seenActiveIds.delete(sessionId);
      canvasStateCache.delete(sessionId);
      const timer = autoPreviewTimersRef.current.get(sessionId);
      if (timer === undefined) continue;
      window.clearTimeout(timer);
      autoPreviewTimersRef.current.delete(sessionId);
    }
    if (removedIds.size === 0) return;
    setStates(previous => {
      let next: Map<string, SessionCanvasState> | null = null;
      for (const sessionId of removedIds) {
        if (!previous.has(sessionId)) continue;
        next ??= new Map(previous);
        next.delete(sessionId);
      }
      return next ?? previous;
    });
  }, [activeSessions]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !connected) return;
    const handleFilesChanged = (event: SessionFilesChangedEvent) => {
      invalidateNavigationFileEvent(event);
      const candidates = event.changes?.filter(change =>
        change.op !== 'delete'
        && isMarkdownPath(change.path)
        && /(?:^|\/)docs\/design\//.test(change.path.toLocaleLowerCase()),
      );
      const candidate = candidates?.at(-1);
      if (!candidate) return;

      const currentState = statesRef.current.get(event.sessionId)
        ?? canvasStateCache.get(event.sessionId)
        ?? EMPTY_STATE;
      const existingTimer = autoPreviewTimersRef.current.get(event.sessionId);
      const activePath = currentState.activeArtifact?.type === 'navigation'
        ? currentState.activeArtifact.request.target?.path
        : currentState.activeArtifact?.request.kind === 'code'
          ? currentState.activeArtifact.request.payload.target.path
          : undefined;
      if (activePath === candidate.path) {
        if (existingTimer !== undefined) {
          window.clearTimeout(existingTimer);
          autoPreviewTimersRef.current.delete(event.sessionId);
        }
        return;
      }

      if (existingTimer !== undefined) window.clearTimeout(existingTimer);
      const timer = window.setTimeout(() => {
        autoPreviewTimersRef.current.delete(event.sessionId);
        const latest = statesRef.current.get(event.sessionId)
          ?? canvasStateCache.get(event.sessionId)
          ?? EMPTY_STATE;
        const latestPath = latest.activeArtifact?.type === 'navigation'
          ? latest.activeArtifact.request.target?.path
          : latest.activeArtifact?.request.kind === 'code'
            ? latest.activeArtifact.request.payload.target.path
            : undefined;
        if (latestPath === candidate.path) return;

        const protectedArtifact = latest.activeArtifact !== null
          && (
            latest.activeArtifact.type === 'typed'
            || latest.activeArtifact.request.source !== 'session_event'
          );
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

    socket.on('session:files-changed', handleFilesChanged);
    return () => {
      socket.off('session:files-changed', handleFilesChanged);
      for (const timer of autoPreviewTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      autoPreviewTimersRef.current.clear();
    };
  }, [connected, openRequest, socketRef]);

  useEffect(() => {
    if (!selectedSessionId) return;
    updateSession(selectedSessionId, restoreCanvasOnSessionSelection);
  }, [selectedSessionId, updateSession]);

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

  const openCode = useCallback((target: NavigationTarget, summary = 'Open code') => {
    const request = createRequest('reveal_range', { target }, summary);
    if (request) openRequest(request);
  }, [createRequest, openRequest]);

  const openCanvas = useCallback(() => {
    const sessionId = selectedRef.current;
    if (!sessionId) return;
    updateSession(sessionId, previous => ({
      ...previous,
      visible: true,
      closedAt: 0,
    }));
  }, [updateSession]);

  const openSessionDiff = useCallback(() => {
    const request = createRequest(
      'open_review',
      {
        diff: {
          source: 'session',
          sessionId: selectedRef.current ?? undefined,
          view: 'inline',
        },
      },
      'Review this session',
    );
    if (request) openRequest(request);
  }, [createRequest, openRequest]);

  const close = useCallback(() => {
    const sessionId = selectedRef.current;
    if (!sessionId) return;
    updateSession(sessionId, closeCanvasState);
  }, [updateSession]);

  const togglePin = useCallback(() => {
    const sessionId = selectedRef.current;
    if (!sessionId) return;
    updateSession(sessionId, toggleCanvasPinState);
  }, [updateSession]);

  const moveHistory = useCallback((direction: -1 | 1) => {
    const sessionId = selectedRef.current;
    if (!sessionId) return;
    updateSession(sessionId, previous => moveCanvasHistory(previous, direction));
  }, [updateSession]);

  const showQueued = useCallback((requestRef: string) => {
    const sessionId = selectedRef.current;
    if (!sessionId) return;
    updateSession(
      sessionId,
      previous => activateQueuedCanvasArtifact(previous, requestRef),
    );
  }, [updateSession]);

  const backToConversation = useCallback(() => {
    close();
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(
        '.mc-console-stage .xterm-helper-textarea',
      )?.focus();
    });
  }, [close]);

  const state = useMemo(
    () => (
      selectedSessionId
        ? states.get(selectedSessionId) ?? EMPTY_STATE
        : EMPTY_STATE
    ),
    [selectedSessionId, states],
  );

  return {
    state,
    isOpen: state.visible,
    openRequest,
    openCanvasRequest,
    openFile,
    openCode,
    openCanvas,
    openSessionDiff,
    resolveDecision,
    close,
    togglePin,
    back: () => moveHistory(-1),
    forward: () => moveHistory(1),
    showQueued,
    backToConversation,
  };
}
