'use client';

import { useState, useCallback, useRef } from 'react';
import type { CharacterData, SessionData } from '@/lib/types';
import { SocketProvider, useSocketContext } from './components/SocketProvider';
import HeaderBar from './components/HeaderBar';
import OfficeCanvas from './components/OfficeCanvas';
import HoverCard from './components/HoverCard';
import SidePanel from './components/SidePanel';
import SetupModal from './components/SetupModal';
import TaskBoard from './components/TaskBoard';
import ResumeModal from './components/ResumeModal';

function sessionToCharData(session: SessionData): CharacterData {
  return {
    id: session.id,
    name: session.name,
    color: session.color,
    status: session.status,
    currentTool: session.currentTool,
    lastToolSummary: session.lastToolSummary,
    lastActivity: session.lastActivity,
    recentActions: session.recentActions,
    teamId: session.teamId,
    isAgent: false,
  };
}

function OfficeView() {
  const { connected, sessions, onEvent } = useSocketContext();

  const [hoveredChar, setHoveredChar] = useState<CharacterData | null>(null);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });
  const [selectedChar, setSelectedChar] = useState<CharacterData | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [taskTrackerId, setTaskTrackerId] = useState<string | null>(null);
  const [showTaskBoard, setShowTaskBoard] = useState(false);
  const [showResume, setShowResume] = useState(false);
  const sessionCycleIndex = useRef(0);

  const handleHover = useCallback((char: CharacterData | null, screenX: number, screenY: number) => {
    setHoveredChar(char);
    setHoverPos({ x: screenX, y: screenY });
  }, []);

  const handleClick = useCallback((char: CharacterData | null) => {
    setSelectedChar(char);
  }, []);

  const handleSetTaskTracker = useCallback((sessionId: string) => {
    setTaskTrackerId((prev) => (prev === sessionId ? null : sessionId));
  }, []);

  const handleSessionsCycle = useCallback(() => {
    const sessionList = Array.from(sessions.values());
    if (sessionList.length === 0) return;
    sessionCycleIndex.current = 0;
    setSelectedChar(sessionToCharData(sessionList[0]));
  }, [sessions]);

  const handleSessionPrev = useCallback(() => {
    const sessionList = Array.from(sessions.values());
    if (sessionList.length === 0) return;
    const idx = (sessionCycleIndex.current - 1 + sessionList.length) % sessionList.length;
    sessionCycleIndex.current = idx;
    setSelectedChar(sessionToCharData(sessionList[idx]));
  }, [sessions]);

  const handleSessionNext = useCallback(() => {
    const sessionList = Array.from(sessions.values());
    if (sessionList.length === 0) return;
    const idx = (sessionCycleIndex.current + 1) % sessionList.length;
    sessionCycleIndex.current = idx;
    setSelectedChar(sessionToCharData(sessionList[idx]));
  }, [sessions]);

  const taskTrackerSession = taskTrackerId ? sessions.get(taskTrackerId) : null;

  return (
    <>
      <HeaderBar
        connected={connected}
        sessionCount={sessions.size}
        onSetupClick={() => setShowSetup(true)}
        onTasksClick={() => setShowTaskBoard(true)}
        onResumeClick={() => setShowResume(true)}
        onSessionsClick={handleSessionsCycle}
      />
      <OfficeCanvas
        sessions={sessions}
        onEvent={onEvent}
        onHover={handleHover}
        onClick={handleClick}
      />
      <HoverCard character={hoveredChar} x={hoverPos.x} y={hoverPos.y} />
      <SidePanel
        character={selectedChar}
        onClose={() => setSelectedChar(null)}
        isTaskTracker={selectedChar ? selectedChar.id === taskTrackerId : false}
        onSetTaskTracker={handleSetTaskTracker}
        onPrev={handleSessionPrev}
        onNext={handleSessionNext}
        sessionIndex={sessionCycleIndex.current}
        sessionTotal={sessions.size}
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
