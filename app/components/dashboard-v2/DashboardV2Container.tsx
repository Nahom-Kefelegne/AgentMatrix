'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { deriveDashboardModel } from '@/lib/dashboard/attentionQueue';
import { perfRender } from '@/lib/perf';
import type { SessionData, SessionEndStatus, SessionRestartStatus } from '@/lib/types';
import { useContextCanvas } from '../context-canvas/useContextCanvas';
import HandoffModal from '../HandoffModal';
import { useSocketContext } from '../SocketProvider';
import DashboardV2 from './DashboardV2';
import type { DashboardV2Navigation, SessionControlState } from './types';
import { useSessionChanges } from './useSessionChanges';

const FullscreenTerminal = dynamic(() => import('../FullscreenTerminal'), { ssr: false });
const SessionInspector = dynamic(() => import('./SessionInspector'), { ssr: false });
type LifecycleTimerKind = 'ack' | 'completion' | 'ready';

function lifecycleTimerKey(sessionId: string, kind: LifecycleTimerKind): string {
  return `${sessionId}:${kind}`;
}

export interface DashboardV2ContainerProps {
  sessions: Map<string, SessionData>;
  contextMap: Record<string, number>;
  initialSessionId?: string | null;
  onSelectionChange?: (sessionId: string | null) => void;
  navigation: DashboardV2Navigation;
}

export default function DashboardV2Container({
  sessions,
  contextMap,
  initialSessionId,
  onSelectionChange,
  navigation,
}: DashboardV2ContainerProps) {
  perfRender('DashboardV2Container');
  const { connected, socketRef } = useSocketContext();
  const [now, setNow] = useState(() => Date.now());
  const sessionList = useMemo(() => Array.from(sessions.values()), [sessions]);
  const model = useMemo(
    () => deriveDashboardModel(sessionList, contextMap, { now }),
    [contextMap, now, sessionList],
  );

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(() => (
    initialSessionId && sessions.has(initialSessionId) ? initialSessionId : null
  ));
  const [pendingSelectionId, setPendingSelectionId] = useState<string | null>(() => (
    initialSessionId && !sessions.has(initialSessionId) ? initialSessionId : null
  ));
  const [fullscreenSessionId, setFullscreenSessionId] = useState<string | null>(null);
  const [handoffSessionId, setHandoffSessionId] = useState<string | null>(null);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [inspectorSessionId, setInspectorSessionId] = useState<string | null>(null);
  const [sessionControls, setSessionControls] = useState<Record<string, SessionControlState>>({});
  const lifecycleTimersRef = useRef<Map<string, number>>(new Map());
  const canvas = useContextCanvas(selectedSessionId, socketRef, connected, sessions);
  const clearLifecycleTimer = useCallback((sessionId: string, kind: LifecycleTimerKind) => {
    const key = lifecycleTimerKey(sessionId, kind);
    const timer = lifecycleTimersRef.current.get(key);
    if (timer !== undefined) window.clearTimeout(timer);
    lifecycleTimersRef.current.delete(key);
  }, []);
  const clearSessionLifecycleTimers = useCallback((sessionId: string) => {
    clearLifecycleTimer(sessionId, 'ack');
    clearLifecycleTimer(sessionId, 'completion');
    clearLifecycleTimer(sessionId, 'ready');
  }, [clearLifecycleTimer]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !connected) return;
    const handleRestartStatus = (event: SessionRestartStatus) => {
      clearLifecycleTimer(event.sessionId, 'ack');
      if (event.phase === 'error') clearLifecycleTimer(event.sessionId, 'ready');
      setSessionControls(previous => ({
        ...previous,
        [event.sessionId]: event.phase === 'error'
          ? { kind: 'error', message: event.error || 'Session restart failed.' }
          : { kind: 'restart', phase: event.phase },
      }));
      if (event.phase === 'ready') {
        clearLifecycleTimer(event.sessionId, 'ready');
        const key = lifecycleTimerKey(event.sessionId, 'ready');
        const timer = window.setTimeout(() => {
          lifecycleTimersRef.current.delete(key);
          setSessionControls(previous => {
            const next = { ...previous };
            delete next[event.sessionId];
            return next;
          });
        }, 1_800);
        lifecycleTimersRef.current.set(key, timer);
      }
    };
    const handleEndStatus = (event: SessionEndStatus) => {
      clearLifecycleTimer(event.sessionId, 'ack');
      if (event.phase === 'error') clearLifecycleTimer(event.sessionId, 'completion');
      setSessionControls(previous => ({
        ...previous,
        [event.sessionId]: event.phase === 'error'
          ? { kind: 'error', message: event.error || 'Session shutdown failed.' }
          : { kind: 'end', phase: 'ending' },
      }));
    };
    const handleSessionEnd = (event: { sessionId: string }) => {
      clearSessionLifecycleTimers(event.sessionId);
      setSessionControls(previous => {
        const next = { ...previous };
        delete next[event.sessionId];
        return next;
      });
    };
    socket.on('session:restart-status' as any, handleRestartStatus);
    socket.on('session:end-status' as any, handleEndStatus);
    socket.on('session:end' as any, handleSessionEnd);
    return () => {
      socket.off('session:restart-status' as any, handleRestartStatus);
      socket.off('session:end-status' as any, handleEndStatus);
      socket.off('session:end' as any, handleSessionEnd);
    };
  }, [clearLifecycleTimer, clearSessionLifecycleTimers, connected, socketRef]);

  useEffect(() => {
    if (connected) return;
    for (const timer of lifecycleTimersRef.current.values()) window.clearTimeout(timer);
    lifecycleTimersRef.current.clear();
    setSessionControls(previous => {
      const next: Record<string, SessionControlState> = {};
      for (const [sessionId, state] of Object.entries(previous)) {
        next[sessionId] = state.kind === 'error'
          ? state
          : { kind: 'error', message: 'Connection lost before the session action completed.' };
      }
      return next;
    });
  }, [connected]);

  useEffect(() => () => {
    for (const timer of lifecycleTimersRef.current.values()) window.clearTimeout(timer);
    lifecycleTimersRef.current.clear();
  }, []);

  useEffect(() => {
    const stillExists = selectedSessionId ? sessions.has(selectedSessionId) : false;
    if (stillExists) return;
    if (pendingSelectionId && !sessions.has(pendingSelectionId)) return;
    const next = model.queue[0]?.sessionId
      ?? model.working[0]?.session.id
      ?? model.idle[0]?.session.id
      ?? null;
    setSelectedSessionId(next);
    onSelectionChange?.(next);
  }, [model.idle, model.queue, model.working, onSelectionChange, pendingSelectionId, selectedSessionId, sessions]);

  useEffect(() => {
    if (!initialSessionId || initialSessionId === selectedSessionId) return;
    if (sessions.has(initialSessionId)) {
      setSelectedSessionId(initialSessionId);
      setPendingSelectionId(null);
      return;
    }
    setPendingSelectionId(initialSessionId);
  }, [initialSessionId, selectedSessionId, sessions]);

  useEffect(() => {
    if (!pendingSelectionId) return;
    if (sessions.has(pendingSelectionId)) {
      setSelectedSessionId(pendingSelectionId);
      setPendingSelectionId(null);
    }
  }, [pendingSelectionId, sessions]);

  useEffect(() => {
    if (inspectorSessionId && !sessions.has(inspectorSessionId)) {
      setInspectorSessionId(null);
    }
  }, [inspectorSessionId, sessions]);

  const handleSelectSession = useCallback((sessionId: string) => {
    setPendingSelectionId(null);
    setSelectedSessionId(sessionId);
    onSelectionChange?.(sessionId);
  }, [onSelectionChange]);

  const selectedSession = selectedSessionId ? sessions.get(selectedSessionId) ?? null : null;
  const selectedContextUsage = selectedSessionId
    ? contextMap[selectedSessionId] ?? selectedSession?.contextUsage ?? null
    : null;
  const selectedAttention = selectedSessionId
    ? model.queue.find(item => item.sessionId === selectedSessionId) ?? null
    : null;
  const reviewSummarySessionId = selectedAttention?.kind === 'ready-to-review'
    ? selectedAttention.sessionId
    : null;
  const changes = useSessionChanges(reviewSummarySessionId, socketRef);

  const handleRequestSummary = useCallback((sessionId: string) => {
    socketRef.current?.emit('session:summary' as any, { sessionId });
  }, [socketRef]);

  const handleReviewChanges = useCallback(() => {
    canvas.openSessionDiff();
  }, [canvas]);

  const handleContinueSession = useCallback((sessionId: string) => {
    setHandoffSessionId(sessionId);
    setHandoffOpen(true);
  }, []);

  const handleRestartSession = useCallback((sessionId: string) => {
    clearSessionLifecycleTimers(sessionId);
    const socket = socketRef.current;
    if (!connected || !socket?.connected) {
      setSessionControls(previous => ({
        ...previous,
        [sessionId]: { kind: 'error', message: 'The session connection is unavailable.' },
      }));
      return;
    }
    setSessionControls(previous => ({
      ...previous,
      [sessionId]: { kind: 'restart', phase: 'stopping' },
    }));
    socket.emit('terminal:restart' as any, { sessionId });
    const key = lifecycleTimerKey(sessionId, 'ack');
    const timer = window.setTimeout(() => {
      lifecycleTimersRef.current.delete(key);
      setSessionControls(previous => ({
        ...previous,
        [sessionId]: { kind: 'error', message: 'AgentMatrix did not acknowledge the restart request.' },
      }));
    }, 3_000);
    lifecycleTimersRef.current.set(key, timer);
  }, [clearSessionLifecycleTimers, connected, socketRef]);

  const handleEndSession = useCallback((sessionId: string) => {
    clearSessionLifecycleTimers(sessionId);
    const socket = socketRef.current;
    if (!connected || !socket?.connected) {
      setSessionControls(previous => ({
        ...previous,
        [sessionId]: { kind: 'error', message: 'The session connection is unavailable.' },
      }));
      return;
    }
    setSessionControls(previous => ({
      ...previous,
      [sessionId]: { kind: 'end', phase: 'ending' },
    }));
    socket.emit('terminal:end' as any, { sessionId });
    const ackKey = lifecycleTimerKey(sessionId, 'ack');
    const ackTimer = window.setTimeout(() => {
      lifecycleTimersRef.current.delete(ackKey);
      setSessionControls(previous => ({
        ...previous,
        [sessionId]: { kind: 'error', message: 'AgentMatrix did not acknowledge the end request.' },
      }));
    }, 3_000);
    lifecycleTimersRef.current.set(ackKey, ackTimer);
    const completionKey = lifecycleTimerKey(sessionId, 'completion');
    const completionTimer = window.setTimeout(() => {
      lifecycleTimersRef.current.delete(completionKey);
      setSessionControls(previous => ({
        ...previous,
        [sessionId]: { kind: 'error', message: 'The session did not close within the expected time.' },
      }));
    }, 12_000);
    lifecycleTimersRef.current.set(completionKey, completionTimer);
  }, [clearSessionLifecycleTimers, connected, socketRef]);

  const fullscreenSession = fullscreenSessionId ? sessions.get(fullscreenSessionId) : null;

  return (
    <>
      <DashboardV2
        model={model}
        selectedSession={selectedSession}
        selectedAttention={selectedAttention}
        selectedSessionId={selectedSessionId}
        selectedContextUsage={selectedContextUsage}
        consoleVisible={!fullscreenSession}
        navigation={navigation}
        canvas={canvas}
        changes={changes}
        sessionControlState={selectedSessionId ? sessionControls[selectedSessionId] ?? null : null}
        sessionControlsAvailable={connected}
        onSelectSession={handleSelectSession}
        onReviewChanges={handleReviewChanges}
        onRequestSummary={handleRequestSummary}
        onFullscreenSession={setFullscreenSessionId}
        onInspectSession={() => setInspectorSessionId(selectedSessionId)}
        onContinueSession={handleContinueSession}
        onRestartSession={handleRestartSession}
        onEndSession={handleEndSession}
      />
      {fullscreenSession ? (
        <FullscreenTerminal
          session={fullscreenSession}
          sessions={sessions}
          onExit={() => setFullscreenSessionId(null)}
        />
      ) : null}
      {handoffSessionId && sessions.has(handoffSessionId) ? (
        <HandoffModal
          key={handoffSessionId}
          isOpen={handoffOpen}
          onClose={() => setHandoffOpen(false)}
          sourceSessionId={handoffSessionId}
          sourceCwd={sessions.get(handoffSessionId)?.cwd}
          onNewSession={sessionId => {
            setHandoffOpen(false);
            setHandoffSessionId(null);
            handleSelectSession(sessionId);
          }}
        />
      ) : null}
      {inspectorSessionId && sessions.has(inspectorSessionId) ? (
        <SessionInspector
          key={inspectorSessionId}
          isOpen
          onClose={() => setInspectorSessionId(null)}
          session={sessions.get(inspectorSessionId)!}
          contextUsage={
            contextMap[inspectorSessionId]
            ?? sessions.get(inspectorSessionId)?.contextUsage
            ?? null
          }
          onOpenTaskBoard={() => {
            setInspectorSessionId(null);
            navigation.onTasks();
          }}
        />
      ) : null}
    </>
  );
}
