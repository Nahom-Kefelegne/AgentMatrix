'use client';

import { useState, useCallback, useRef, useEffect, useMemo, type ComponentProps } from 'react';
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

import { initPerfMonitor } from '@/lib/perf';

const EditorView = dynamic(() => import('./components/editor/EditorView'), { ssr: false });
interface DashboardV2Props extends ComponentProps<typeof DashboardView> {
  initialSessionId?: string | null;
  onSelectionChange?: (sessionId: string | null) => void;
  navigation: DashboardV2Navigation;
}

const DashboardV2Container = dynamic<DashboardV2Props>(
  () => import('./components/dashboard-v2/DashboardV2Container'),
  { ssr: false },
);
const INTRO_STORAGE_KEY = 'agentmatrix-intro-v2';

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
  const [orchestratorViewId, setOrchestratorViewId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showIntro, setShowIntro] = useState(true);
  const [viewMode, setViewMode] = useState<'office' | 'dashboard' | 'editor'>('dashboard');
  const [editorUnlocked, setEditorUnlocked] = useState(false);
  const canvasRef = useRef<OfficeCanvasHandle>(null);

  useEffect(() => {
    try {
      const forced = new URLSearchParams(window.location.search).get('intro') === '1';
      setShowIntro(forced || localStorage.getItem(INTRO_STORAGE_KEY) !== 'done');
    } catch {
      setShowIntro(true);
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

  // Opening a completed session acknowledges it. Attention is intentionally
  // NOT cleared here: it remains visible until the user actually responds and
  // Copilot/Claude emits new prompt/tool activity.
  useEffect(() => {
    if (!selectedSessionId) return;
    const session = sessions.get(selectedSessionId);
    if (session?.status === 'done') {
      fetch('/api/hooks/mcp-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: '__clear_status', sessionId: selectedSessionId }),
      }).catch(() => {});
    }
  }, [selectedSessionId, sessions]);

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
  const handleIntroComplete = useCallback(() => {
    try { localStorage.setItem(INTRO_STORAGE_KEY, 'done'); } catch { /* non-fatal */ }
    setShowIntro(false);
  }, []);
  const handleReplayIntro = useCallback(() => {
    setShowSettings(false);
    setShowIntro(true);
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

  const dashboardV2Active = viewMode === 'dashboard' && dashboardV2Loaded && dashboardV2Enabled;

  if (showIntro) {
    return <FirstRunIntro onComplete={handleIntroComplete} />;
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

      {viewMode === 'dashboard' && dashboardV2Loaded && dashboardV2Enabled && !selectedSessionId && (
        <DashboardV2Container
          sessions={sessions}
          contextMap={contextMap}
          onSelectSession={(id) => setSelectedSessionId(id)}
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

      <SessionDialog
        sessionId={selectedSessionId}
        sessions={sessions}
        onClose={handleCloseDialog}
        onPrev={handlePrevSession}
        onNext={handleNextSession}
        onSelectSession={(id) => setSelectedSessionId(id)}
        onOpenTask={(taskId) => { setOpenTaskId(taskId); setShowTaskBoard(true); }}
        sessionIndex={currentSessionIndex}
        sessionTotal={sessionList.length}
      />

      <SetupModal isOpen={showSetup} onClose={() => setShowSetup(false)} connected={connected} sessionCount={sessions.size} />
      {/* Lazy-mount the heavier modals so they don't reconcile on every
          OfficeView re-render (constant during streaming) while closed, and only
          fire their data fetches once actually opened. */}
      {showTaskBoard && (
        <TaskBoard isOpen onClose={() => { setShowTaskBoard(false); setOpenTaskId(null); }} onOpenSession={(id) => setSelectedSessionId(id)} initialTaskId={openTaskId} />
      )}
      {showResume && (
        <ResumeModal isOpen onClose={() => setShowResume(false)} onResumeInApp={(sid, cliType) => { setSelectedSessionId(sid); socketRef?.current?.emit('terminal:resume' as any, { sessionId: sid, cliType }); }} />
      )}
      <SpawnModal isOpen={showSpawn} onClose={() => setShowSpawn(false)} onSessionSpawned={(sid) => setSelectedSessionId(sid)} />
      <AppSettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        onViewOrchestrator={(id) => setOrchestratorViewId(id)}
        dashboardV2Enabled={storedDashboardV2Enabled}
        dashboardV2Override={dashboardV2Override}
        onDashboardV2Change={setStoredDashboardV2Enabled}
        onReplayIntro={handleReplayIntro}
      />

      {orchestratorViewId && (() => {
        const orchSessions = new Map(sessions);
        if (!orchSessions.has(orchestratorViewId)) {
          orchSessions.set(orchestratorViewId, {
            id: orchestratorViewId, name: 'Orchestrator', color: '#cc5de8', status: 'idle',
            deskIndex: -1, deskPosition: { x: 0, y: 0 }, spawnPosition: { x: 0, y: 0 },
            recentActions: [], agents: [], cwd: undefined, createdAt: Date.now(),
          });
        }
        return <SessionDialog sessionId={orchestratorViewId} sessions={orchSessions} onClose={() => setOrchestratorViewId(null)} readOnly />;
      })()}
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
