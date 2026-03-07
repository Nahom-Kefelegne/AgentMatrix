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

function OfficeView() {
  const { connected, sessions, onEvent, socketRef } = useSocketContext();

  const [hoveredChar, setHoveredChar] = useState<CharacterData | null>(null);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [taskTrackerId, setTaskTrackerId] = useState<string | null>(null);
  const [showTaskBoard, setShowTaskBoard] = useState(false);
  const [showResume, setShowResume] = useState(false);
  const [showSpawn, setShowSpawn] = useState(false);
  const [viewMode, setViewMode] = useState<'office' | 'dashboard'>('office');
  const canvasRef = useRef<OfficeCanvasHandle>(null);

  const handleHover = useCallback((char: CharacterData | null, screenX: number, screenY: number) => {
    setHoveredChar(char);
    setHoverPos({ x: screenX, y: screenY });
  }, []);

  const handleClick = useCallback((char: CharacterData | null) => {
    setSelectedSessionId(char?.id ?? null);
  }, []);

  const handleCloseDialog = useCallback(() => {
    setSelectedSessionId(null);
  }, []);

  const handleSetTaskTracker = useCallback((sessionId: string) => {
    setTaskTrackerId((prev) => (prev === sessionId ? null : sessionId));
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

  const taskTrackerSession = taskTrackerId ? sessions.get(taskTrackerId) : null;

  return (
    <>
      <HeaderBar
        connected={connected}
        sessionCount={sessions.size}
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
        isTaskTracker={selectedSessionId ? selectedSessionId === taskTrackerId : false}
        onSetTaskTracker={handleSetTaskTracker}
        onPrev={handlePrevSession}
        onNext={handleNextSession}
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
        onClose={() => setShowTaskBoard(false)}
        sessionId={taskTrackerId}
        sessionName={taskTrackerSession?.name || 'All Tasks'}
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
    </>
  );
}

export default function Home() {
  return (
    <SocketProvider>
      <OfficeView />
    </SocketProvider>
  );
}
