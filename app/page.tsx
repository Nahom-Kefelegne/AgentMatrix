'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import type { CharacterData } from '@/lib/types';
import { useSessionContext } from '@/lib/hooks/useSessionContext';
import { useDashboardV2Flag } from '@/lib/hooks/useDashboardV2Flag';
import { SocketProvider, useSocketContext } from './components/SocketProvider';
import { ThemeProvider } from './components/ThemeProvider';
import HeaderBar from './components/HeaderBar';
import OfficeCanvas from './components/OfficeCanvas';
import type { OfficeCanvasHandle } from './components/OfficeCanvas';
import HoverCard from './components/HoverCard';
import SetupModal from './components/SetupModal';
import TaskBoard from './components/TaskBoard';
import ResumeModal from './components/ResumeModal';
import DashboardView from './components/DashboardView';
import SessionDialog from './components/SessionDialog';
import SpawnModal from './components/SpawnModal';
import AppSettingsModal from './components/AppSettingsModal';
import FirstRunIntro from './components/FirstRunIntro';
import SplashScreen from './components/SplashScreen';
import type { DashboardV2Navigation } from './components/dashboard-v2/types';
import type { DashboardV2ContainerProps } from './components/dashboard-v2/DashboardV2Container';
import {
  CURRENT_RELEASE_BRIEFING,
  RELEASE_BRIEFING_STORAGE_KEY,
  WELCOME_COMPLETION_STORAGE_KEY,
  resolveIntroBriefing,
  type IntroBriefingLaunch,
} from '@/lib/onboarding/releaseBriefing';

import { initPerfMonitor } from '@/lib/perf';

const EditorView = dynamic(() => import('./components/editor/EditorView'), { ssr: false });
type DashboardV2Props = DashboardV2ContainerProps;

const DashboardV2Container = dynamic<DashboardV2Props>(
  () => import('./components/dashboard-v2/DashboardV2Container'),
  { ssr: false },
);

function OfficeView() {
  const { connected, sessions, onEvent, socketRef } = useSocketContext();
  const contextMap = useSessionContext(socketRef, connected);
  const {
    enabled: dashboardV2Enabled,
    storedEnabled: storedDashboardV2Enabled,
    override: dashboardV2Override,
    loaded: dashboardV2Loaded,
    setStoredEnabled: setStoredDashboardV2Enabled,
  } = useDashboardV2Flag();

  const [hoveredChar, setHoveredChar] = useState<CharacterData | null>(null);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [dashboardV2SessionId, setDashboardV2SessionId] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [showTaskBoard, setShowTaskBoard] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [showResume, setShowResume] = useState(false);
  const [showSpawn, setShowSpawn] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [introLaunch, setIntroLaunch] = useState<IntroBriefingLaunch | null | undefined>(undefined);
  const [viewMode, setViewMode] = useState<'office' | 'dashboard' | 'editor'>('dashboard');
  const [editorUnlocked, setEditorUnlocked] = useState(false);
  const canvasRef = useRef<OfficeCanvasHandle>(null);
  const dashboardV2Active = viewMode === 'dashboard' && dashboardV2Loaded && dashboardV2Enabled;

  useEffect(() => {
    try {
      const introParam = new URLSearchParams(window.location.search).get('intro');
      const launch = resolveIntroBriefing({
        forced: introParam === '1',
        forceRelease: introParam === 'release',
        welcomeCompleted: localStorage.getItem(WELCOME_COMPLETION_STORAGE_KEY) === 'done',
        acknowledgedCampaignId: localStorage.getItem(RELEASE_BRIEFING_STORAGE_KEY),
      });
      setIntroLaunch(launch);
    } catch {
      setIntroLaunch({ variant: 'welcome', initialPage: 0 });
    }
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target;
      if (
        target instanceof HTMLElement
        && (
          target.isContentEditable
          || target.tagName === 'INPUT'
          || target.tagName === 'TEXTAREA'
          || target.tagName === 'SELECT'
          || target.closest('.xterm')
        )
      ) return;
      if (e.code === 'KeyE' && e.shiftKey && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setEditorUnlocked(prev => {
          const next = !prev;
          if (next) setViewMode('editor');
          else if (viewMode === 'editor') setViewMode('dashboard');
          return next;
        });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [viewMode]);

  const handleHover = useCallback((char: CharacterData | null, screenX: number, screenY: number) => {
    setHoveredChar(char);
    setHoverPos({ x: screenX, y: screenY });
  }, []);

  const handleClick = useCallback((char: CharacterData | null) => {
    if (!char) { setSelectedSessionId(null); return; }
    if (char.isAgent) {
      for (const [sid, s] of sessions) {
        if (s.agents?.some(a => a.id === char.id || a.name === char.name)) {
          setSelectedSessionId(sid);
          return;
        }
      }
    }
    setSelectedSessionId(char.id);
  }, [sessions]);

  const handleCloseDialog = useCallback(() => setSelectedSessionId(null), []);

  // Auto-clear selectedSessionId when the session is removed (ended/killed)
  useEffect(() => {
    if (selectedSessionId && !sessions.has(selectedSessionId)) {
      setSelectedSessionId(null);
    }
  }, [selectedSessionId, sessions]);

  // Dashboard V2 keeps its selected console across the optional legacy dialog.
  // Track prev/next/session switches made inside that dialog so closing it returns
  // to the same session instead of remounting the previous console selection.
  useEffect(() => {
    if (dashboardV2Enabled && selectedSessionId) {
      setDashboardV2SessionId(selectedSessionId);
    }
  }, [dashboardV2Enabled, selectedSessionId]);

  const activeSessionId = dashboardV2Active ? dashboardV2SessionId : selectedSessionId;

  // Opening a completed session acknowledges it. Attention is intentionally
  // NOT cleared here: it remains visible until the user actually responds and
  // Copilot/Claude emits new prompt/tool activity.
  useEffect(() => {
    if (!activeSessionId) return;
    const session = sessions.get(activeSessionId);
    if (session?.status === 'done') {
      fetch('/api/hooks/mcp-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: '__clear_status', sessionId: activeSessionId }),
      }).catch(() => {});
    }
  }, [activeSessionId, sessions]);

  const sessionList = Array.from(sessions.values());
  const currentSessionIndex = selectedSessionId
    ? sessionList.findIndex(s => s.id === selectedSessionId)
    : -1;

  const handlePrevSession = useCallback(() => {
    if (sessionList.length === 0) return;
    const idx = (currentSessionIndex - 1 + sessionList.length) % sessionList.length;
    setSelectedSessionId(sessionList[idx].id);
  }, [sessionList, currentSessionIndex]);

  const handleNextSession = useCallback(() => {
    if (sessionList.length === 0) return;
    const idx = (currentSessionIndex + 1) % sessionList.length;
    setSelectedSessionId(sessionList[idx].id);
  }, [sessionList, currentSessionIndex]);

  const handleViewChange = useCallback((mode: 'office' | 'dashboard' | 'editor') => setViewMode(mode), []);
  const handleOpenSettings = useCallback(() => setShowSettings(true), []);
  const handleOpenSetup = useCallback(() => setShowSetup(true), []);
  const handleOpenTasks = useCallback(() => setShowTaskBoard(true), []);
  const handleOpenResume = useCallback(() => setShowResume(true), []);
  const handleOpenSpawn = useCallback(() => setShowSpawn(true), []);
  const handleRouteToSession = useCallback((sessionId: string) => {
    if (dashboardV2Loaded && dashboardV2Enabled) {
      setSelectedSessionId(null);
      setDashboardV2SessionId(sessionId);
      setViewMode('dashboard');
      return;
    }
    setSelectedSessionId(sessionId);
  }, [dashboardV2Enabled, dashboardV2Loaded]);
  const handleIntroComplete = useCallback(() => {
    try {
      localStorage.setItem(WELCOME_COMPLETION_STORAGE_KEY, 'done');
      localStorage.setItem(RELEASE_BRIEFING_STORAGE_KEY, CURRENT_RELEASE_BRIEFING.id);
    } catch { /* non-fatal */ }
    setIntroLaunch(null);
  }, []);
  const handleReplayIntro = useCallback(() => {
    setShowSettings(false);
    setIntroLaunch({ variant: 'replay', initialPage: 0 });
  }, []);

  const dashboardV2Navigation = useMemo<DashboardV2Navigation>(() => ({
    connected,
    sessionCount: sessions.size,
    editorUnlocked,
    onViewChange: handleViewChange,
    onNewSession: handleOpenSpawn,
    onResume: handleOpenResume,
    onTasks: handleOpenTasks,
    onSettings: handleOpenSettings,
    onSetup: handleOpenSetup,
  }), [
    connected,
    editorUnlocked,
    handleOpenResume,
    handleOpenSettings,
    handleOpenSetup,
    handleOpenSpawn,
    handleOpenTasks,
    handleViewChange,
    sessions.size,
  ]);

  if (introLaunch === undefined) return null;

  if (introLaunch) {
    return (
      <FirstRunIntro
        key={`${introLaunch.variant}:${introLaunch.initialPage}:${introLaunch.releaseTitle ?? ''}`}
        onComplete={handleIntroComplete}
        variant={introLaunch.variant}
        initialPage={introLaunch.initialPage}
        releaseTitle={introLaunch.releaseTitle}
      />
    );
  }

  return (
    <>
      {!dashboardV2Active && (
        <HeaderBar
          connected={connected}
          onSettingsClick={handleOpenSettings}
          onSetupClick={handleOpenSetup}
          onTasksClick={handleOpenTasks}
          onResumeClick={handleOpenResume}
          onNewSessionClick={handleOpenSpawn}
          viewMode={viewMode}
          onViewChange={handleViewChange}
          editorUnlocked={editorUnlocked}
        />
      )}

      {/* Office view is enabled but mounted ONLY while it's the active view: its
          GameEngine runs a 60fps requestAnimationFrame render loop, so keeping
          it mounted (even hidden) would burn CPU/GPU — and stream frames over a
          remote session — behind the dashboard. Unmounting on view change runs
          the engine's cleanup (cancelAnimationFrame), so the loop only runs
          while you're actually looking at the office. */}
      {viewMode === 'office' && (
        <div style={{ display: 'contents' }}>
          <OfficeCanvas
            ref={canvasRef}
            sessions={sessions}
            onEvent={onEvent}
            onHover={handleHover}
            onClick={handleClick}
            scrollToId={selectedSessionId}
            socketRef={socketRef}
            connected={connected}
          />
          <HoverCard character={hoveredChar} x={hoverPos.x} y={hoverPos.y} />
        </div>
      )}

      {viewMode === 'dashboard' && !dashboardV2Loaded && (
        <div className="dashboard-bg" style={{ height: '100vh', position: 'relative' }}>
          <div className="noise-overlay" />
          <div style={{ position: 'relative', zIndex: 1, maxWidth: 1200, margin: '0 auto', padding: '72px 36px 80px' }} />
        </div>
      )}

      {viewMode === 'dashboard' && dashboardV2Loaded && dashboardV2Enabled && (
        <DashboardV2Container
          sessions={sessions}
          contextMap={contextMap}
          initialSessionId={dashboardV2SessionId}
          onSelectionChange={setDashboardV2SessionId}
          navigation={dashboardV2Navigation}
        />
      )}

      {viewMode === 'dashboard' && dashboardV2Loaded && !dashboardV2Enabled && (
        <div style={{ display: selectedSessionId ? 'none' : 'contents' }}>
          <DashboardView sessions={sessions} contextMap={contextMap} onSelectSession={(id) => setSelectedSessionId(id)} />
        </div>
      )}

      {viewMode === 'editor' && <EditorView />}

      {!dashboardV2Active ? (
        <SessionDialog
          sessionId={selectedSessionId}
          sessions={sessions}
          onClose={handleCloseDialog}
          onPrev={handlePrevSession}
          onNext={handleNextSession}
          onSelectSession={handleRouteToSession}
          onOpenTask={(taskId) => { setOpenTaskId(taskId); setShowTaskBoard(true); }}
          sessionIndex={currentSessionIndex}
          sessionTotal={sessionList.length}
        />
      ) : null}

      <SetupModal isOpen={showSetup} onClose={() => setShowSetup(false)} connected={connected} sessionCount={sessions.size} />
      {/* Lazy-mount the heavier modals so they don't reconcile on every
          OfficeView re-render (constant during streaming) while closed, and only
          fire their data fetches once actually opened. */}
      {showTaskBoard && (
        <TaskBoard isOpen onClose={() => { setShowTaskBoard(false); setOpenTaskId(null); }} onOpenSession={handleRouteToSession} initialTaskId={openTaskId} />
      )}
      {showResume && (
        <ResumeModal
          isOpen
          onClose={() => setShowResume(false)}
          onResumeInApp={(session) => {
            handleRouteToSession(session.sessionId);
            socketRef?.current?.emit('terminal:resume' as any, session);
          }}
        />
      )}
      <SpawnModal isOpen={showSpawn} onClose={() => setShowSpawn(false)} onSessionSpawned={handleRouteToSession} />
      <AppSettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        dashboardV2Enabled={storedDashboardV2Enabled}
        dashboardV2Override={dashboardV2Override}
        onDashboardV2Change={setStoredDashboardV2Enabled}
        onReplayIntro={handleReplayIntro}
      />
    </>
  );
}

export default function Home() {
  useEffect(() => { initPerfMonitor(); }, []);
  useEffect(() => {
    // Reduced-motion mode: on a remote/RDP session every animated frame must be
    // re-encoded and streamed, so continuous decorative animations (orbs drift,
    // ticker scroll, matrix rain, pulsing dots, card heartbeat) saturate the
    // remote pipeline and make the whole UI feel laggy — including hovers.
    // Enable when: manual override 'am-reduce-motion'='1', OS prefers-reduced-
    // motion, or a detected remote session. Manual '0' force-disables (in case
    // auto-detect misfires). Set via DevTools: localStorage.setItem('am-reduce-motion','1').
    const apply = () => document.documentElement.classList.add('reduce-motion');
    let override: string | null = null;
    try { override = localStorage.getItem('am-reduce-motion'); } catch { /* ignore */ }
    if (override === '1') { apply(); return; }
    if (override === '0') return;
    try {
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { apply(); return; }
    } catch { /* ignore */ }
    fetch('/api/system')
      .then(r => r.json())
      .then((d: { remote?: boolean }) => { if (d?.remote) apply(); })
      .catch(() => { /* ignore */ });
  }, []);
  return (
    <ThemeProvider>
      <SocketProvider>
        <SplashScreen>
          <OfficeView />
        </SplashScreen>
      </SocketProvider>
    </ThemeProvider>
  );
}
