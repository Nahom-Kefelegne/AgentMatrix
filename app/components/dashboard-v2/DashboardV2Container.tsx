'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { deriveDashboardModel } from '@/lib/dashboard/attentionQueue';
import { perfRender } from '@/lib/perf';
import type { SessionData } from '@/lib/types';
import { useSocketContext } from '../SocketProvider';
import DashboardV2 from './DashboardV2';
import type { DashboardV2Navigation } from './types';
import { useSessionChanges } from './useSessionChanges';

const ChangesViewer = dynamic(() => import('../ChangesViewer'), {
  ssr: false,
  loading: () => <div className="mc-review-loading" role="status">Loading review workspace…</div>,
});

const FullscreenTerminal = dynamic(() => import('../FullscreenTerminal'), { ssr: false });

export interface DashboardV2ContainerProps {
  sessions: Map<string, SessionData>;
  contextMap: Record<string, number>;
  onSelectSession: (id: string) => void;
  initialSessionId?: string | null;
  onSelectionChange?: (sessionId: string | null) => void;
  navigation: DashboardV2Navigation;
}

export default function DashboardV2Container({
  sessions,
  contextMap,
  onSelectSession,
  initialSessionId,
  onSelectionChange,
  navigation,
}: DashboardV2ContainerProps) {
  perfRender('DashboardV2Container');
  const { socketRef } = useSocketContext();
  const [now, setNow] = useState(() => Date.now());
  const sessionList = useMemo(() => Array.from(sessions.values()), [sessions]);
  const model = useMemo(
    () => deriveDashboardModel(sessionList, contextMap, { now }),
    [contextMap, now, sessionList],
  );

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(() => (
    initialSessionId && sessions.has(initialSessionId) ? initialSessionId : null
  ));
  const [reviewSessionId, setReviewSessionId] = useState<string | null>(null);
  const [fullscreenSessionId, setFullscreenSessionId] = useState<string | null>(null);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const stillExists = selectedSessionId ? sessions.has(selectedSessionId) : false;
    if (stillExists) return;
    const next = model.queue[0]?.sessionId
      ?? model.working[0]?.session.id
      ?? model.idle[0]?.session.id
      ?? null;
    setSelectedSessionId(next);
    onSelectionChange?.(next);
  }, [model.idle, model.queue, model.working, onSelectionChange, selectedSessionId, sessions]);

  const handleSelectSession = useCallback((sessionId: string) => {
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

  const handleReviewChanges = useCallback((sessionId: string) => {
    setReviewSessionId(sessionId);
  }, []);

  const reviewSession = reviewSessionId ? sessions.get(reviewSessionId) : null;
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
        changes={changes}
        onSelectSession={handleSelectSession}
        onOpenSession={onSelectSession}
        onReviewChanges={handleReviewChanges}
        onRequestSummary={handleRequestSummary}
        onFullscreenSession={setFullscreenSessionId}
      />
      {reviewSession ? (
        <ChangesViewer
          sessionId={reviewSession.id}
          sessionName={reviewSession.name}
          cwd={reviewSession.cwd}
          onClose={() => setReviewSessionId(null)}
          socketRef={socketRef}
        />
      ) : null}
      {fullscreenSession ? (
        <FullscreenTerminal
          session={fullscreenSession}
          sessions={sessions}
          onExit={() => setFullscreenSessionId(null)}
        />
      ) : null}
    </>
  );
}
