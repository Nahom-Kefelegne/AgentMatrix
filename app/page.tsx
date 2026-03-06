'use client';

import { useState, useCallback } from 'react';
import type { CharacterData } from '@/lib/types';
import { SocketProvider, useSocketContext } from './components/SocketProvider';
import HeaderBar from './components/HeaderBar';
import OfficeCanvas from './components/OfficeCanvas';
import HoverCard from './components/HoverCard';
import SidePanel from './components/SidePanel';
import SetupModal from './components/SetupModal';
import TaskBoard from './components/TaskBoard';

function OfficeView() {
  const { connected, sessions, onEvent } = useSocketContext();

  const [hoveredChar, setHoveredChar] = useState<CharacterData | null>(null);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });
  const [selectedChar, setSelectedChar] = useState<CharacterData | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [taskTrackerId, setTaskTrackerId] = useState<string | null>(null);
  const [showTaskBoard, setShowTaskBoard] = useState(false);

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

  const taskTrackerSession = taskTrackerId ? sessions.get(taskTrackerId) : null;

  return (
    <>
      <HeaderBar
        connected={connected}
        onSetupClick={() => setShowSetup(true)}
        onTasksClick={() => setShowTaskBoard(true)}
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
