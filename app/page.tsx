'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import dynamic from 'next/dynamic';
import type { CharacterData } from '@/lib/types';
import { useSessionContext } from '@/lib/hooks/useSessionContext';
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
import SplashScreen from './components/SplashScreen';

const EditorView = dynamic(() => import('./components/editor/EditorView'), { ssr: false });

function OfficeView() {
  const { connected, sessions, onEvent, socketRef } = useSocketContext();
  const contextMap = useSessionContext(socketRef, connected);

  const [hoveredChar, setHoveredChar] = useState<CharacterData | null>(null);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [showTaskBoard, setShowTaskBoard] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [showResume, setShowResume] = useState(false);
  const [showSpawn, setShowSpawn] = useState(false);
  const [orchestratorViewId, setOrchestratorViewId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [viewMode, setViewMode] = useState<'office' | 'dashboard' | 'editor'>('dashboard');
  const [editorUnlocked, setEditorUnlocked] = useState(false);
  const canvasRef = useRef<OfficeCanvasHandle>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
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

  // Clear done/attention status when user opens a session
  useEffect(() => {
    if (!selectedSessionId) return;
    const session = sessions.get(selectedSessionId);
    if (session && (session.status === 'done' || session.status === 'attention')) {
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

  const handleSessionsCycle = useCallback(() => {
    if (sessionList.length === 0) return;
    setSelectedSessionId(sessionList[0].id);
  }, [sessionList]);

  return (
    <>
      <HeaderBar
        connected={connected}
        sessionCount={sessions.size}
        onSettingsClick={() => setShowSettings(true)}
        onSetupClick={() => setShowSetup(true)}
        onTasksClick={() => setShowTaskBoard(true)}
        onResumeClick={() => setShowResume(true)}
        onNewSessionClick={() => setShowSpawn(true)}
        onSessionsClick={handleSessionsCycle}
        viewMode={viewMode}
        onViewChange={(mode) => setViewMode(mode)}
        editorUnlocked={editorUnlocked}
      />

      {/* Office view — TEST: unmount when not active so its 60fps canvas
          render loop (requestAnimationFrame) stops instead of running hidden
          behind the dashboard. Previously kept mounted (display:none) to
          preserve the engine, but that left the loop burning CPU on other
          views. */}
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

      {viewMode === 'dashboard' && (
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
      <TaskBoard isOpen={showTaskBoard} onClose={() => { setShowTaskBoard(false); setOpenTaskId(null); }} onOpenSession={(id) => setSelectedSessionId(id)} initialTaskId={openTaskId} />
      <ResumeModal isOpen={showResume} onClose={() => setShowResume(false)} onResumeInApp={(sid, cliType) => { setSelectedSessionId(sid); socketRef?.current?.emit('terminal:resume' as any, { sessionId: sid, cliType }); }} />
      <SpawnModal isOpen={showSpawn} onClose={() => setShowSpawn(false)} onSessionSpawned={(sid) => setSelectedSessionId(sid)} />
      <AppSettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} onViewOrchestrator={(id) => setOrchestratorViewId(id)} />

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
