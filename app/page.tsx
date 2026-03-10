'use client';

import { useState, useCallback, useRef } from 'react';
import type { CharacterData } from '@/lib/types';
import { SocketProvider, useSocketContext } from './components/SocketProvider';
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

function OfficeView() {
  const { connected, sessions, onEvent, socketRef } = useSocketContext();

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
  const [viewMode, setViewMode] = useState<'office' | 'dashboard'>('dashboard');
  const canvasRef = useRef<OfficeCanvasHandle>(null);

  const handleHover = useCallback((char: CharacterData | null, screenX: number, screenY: number) => {
    setHoveredChar(char);
    setHoverPos({ x: screenX, y: screenY });
  }, []);

  const handleClick = useCallback((char: CharacterData | null) => {
    if (!char) { setSelectedSessionId(null); return; }
    // Agents open their parent session dialog
    if (char.isAgent) {
      // Find which session has this agent
      for (const [sid, s] of sessions) {
        if (s.agents?.some(a => a.id === char.id || a.name === char.name)) {
          setSelectedSessionId(sid);
          return;
        }
      }
    }
    setSelectedSessionId(char.id);
  }, [sessions]);

  const handleCloseDialog = useCallback(() => {
    setSelectedSessionId(null);
  }, []);

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
        onToggleView={() => setViewMode(m => m === 'office' ? 'dashboard' : 'office')}
      />

      {/* Office view — keep mounted to preserve canvas engine */}
      <div style={{ display: viewMode === 'office' ? 'contents' : 'none' }}>
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

      {/* Dashboard view */}
      {viewMode === 'dashboard' && (
        <DashboardView
          sessions={sessions}
          onSelectSession={(id) => setSelectedSessionId(id)}
        />
      )}

      {/* Session dialog */}
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

      <SetupModal
        isOpen={showSetup}
        onClose={() => setShowSetup(false)}
        connected={connected}
        sessionCount={sessions.size}
      />
      <TaskBoard
        isOpen={showTaskBoard}
        onClose={() => { setShowTaskBoard(false); setOpenTaskId(null); }}
        onOpenSession={(id) => setSelectedSessionId(id)}
        initialTaskId={openTaskId}
      />
      <ResumeModal
        isOpen={showResume}
        onClose={() => setShowResume(false)}
        onResumeInApp={(sid) => {
          setSelectedSessionId(sid);
          const socket = socketRef?.current;
          if (socket) socket.emit('terminal:resume' as any, { sessionId: sid });
        }}
      />
      <SpawnModal
        isOpen={showSpawn}
        onClose={() => setShowSpawn(false)}
        onSessionSpawned={(sid) => setSelectedSessionId(sid)}
      />
      <AppSettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        onViewOrchestrator={(id) => setOrchestratorViewId(id)}
      />

      {/* Orchestrator viewer — uses SessionDialog in read-only mode */}
      {orchestratorViewId && (() => {
        // Create a synthetic sessions map with the orchestrator entry
        const orchSessions = new Map(sessions);
        if (!orchSessions.has(orchestratorViewId)) {
          orchSessions.set(orchestratorViewId, {
            id: orchestratorViewId,
            name: 'Orchestrator',
            color: '#cc5de8',
            status: 'idle',
            deskIndex: -1,
            deskPosition: { x: 0, y: 0 },
            spawnPosition: { x: 0, y: 0 },
            recentActions: [],
            agents: [],
            cwd: undefined,
            createdAt: Date.now(),
          });
        }
        return (
          <SessionDialog
            sessionId={orchestratorViewId}
            sessions={orchSessions}
            onClose={() => setOrchestratorViewId(null)}
            readOnly
          />
        );
      })()}
    </>
  );
}

export default function Home() {
  return (
    <SocketProvider>
      <SplashScreen>
        <OfficeView />
      </SplashScreen>
    </SocketProvider>
  );
}
