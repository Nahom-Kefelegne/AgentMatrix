'use client';

import { useState, useCallback, useRef } from 'react';
import type { CharacterData, SessionData } from '@/lib/types';
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
import FloatingSprite from './components/FloatingSprite';

interface SpriteInfo {
  dataURL: string;
  startX: number;
  startY: number;
  name: string;
  color: string;
}

function OfficeView() {
  const { connected, sessions, onEvent } = useSocketContext();

  const [hoveredChar, setHoveredChar] = useState<CharacterData | null>(null);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [taskTrackerId, setTaskTrackerId] = useState<string | null>(null);
  const [showTaskBoard, setShowTaskBoard] = useState(false);
  const [showResume, setShowResume] = useState(false);
  const [viewMode, setViewMode] = useState<'office' | 'dashboard'>('office');
  const [floatingSprite, setFloatingSprite] = useState<SpriteInfo | null>(null);
  const [spriteAnimated, setSpriteAnimated] = useState(false);
  const canvasRef = useRef<OfficeCanvasHandle>(null);

  const handleHover = useCallback((char: CharacterData | null, screenX: number, screenY: number) => {
    setHoveredChar(char);
    setHoverPos({ x: screenX, y: screenY });
  }, []);

  const handleClick = useCallback((char: CharacterData | null) => {
    if (!char) {
      setSelectedSessionId(null);
      setFloatingSprite(null);
      setSpriteAnimated(false);
      return;
    }

    // Get sprite screen info from the engine
    const info = canvasRef.current?.getCharacterScreenInfo(char.id);
    if (info) {
      setFloatingSprite({
        dataURL: info.spriteDataURL,
        startX: info.screenX,
        startY: info.screenY,
        name: info.name,
        color: info.color,
      });
      setSpriteAnimated(false);
      // Trigger animation on next frame
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setSpriteAnimated(true));
      });
    } else {
      setFloatingSprite(null);
    }

    setSelectedSessionId(char.id);
  }, []);

  // Clear floating sprite when dialog closes
  const handleCloseDialog = useCallback(() => {
    setSpriteAnimated(false);
    // Wait for reverse animation then clear
    setTimeout(() => {
      setSelectedSessionId(null);
      setFloatingSprite(null);
    }, 300);
  }, []);

  const handleSetTaskTracker = useCallback((sessionId: string) => {
    setTaskTrackerId((prev) => (prev === sessionId ? null : sessionId));
  }, []);

  // Navigate to a session by index, updating sprite + dialog
  const navigateToSession = useCallback((sessionId: string) => {
    const info = canvasRef.current?.getCharacterScreenInfo(sessionId);
    if (info) {
      setFloatingSprite({
        dataURL: info.spriteDataURL,
        startX: info.screenX,
        startY: info.screenY,
        name: info.name,
        color: info.color,
      });
      setSpriteAnimated(false);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setSpriteAnimated(true));
      });
    }
    setSelectedSessionId(sessionId);
  }, []);

  const sessionList = Array.from(sessions.values());
  const currentSessionIndex = selectedSessionId
    ? sessionList.findIndex(s => s.id === selectedSessionId)
    : -1;

  const handlePrevSession = useCallback(() => {
    if (sessionList.length === 0) return;
    const idx = (currentSessionIndex - 1 + sessionList.length) % sessionList.length;
    navigateToSession(sessionList[idx].id);
  }, [sessionList, currentSessionIndex, navigateToSession]);

  const handleNextSession = useCallback(() => {
    if (sessionList.length === 0) return;
    const idx = (currentSessionIndex + 1) % sessionList.length;
    navigateToSession(sessionList[idx].id);
  }, [sessionList, currentSessionIndex, navigateToSession]);

  const handleSessionsCycle = useCallback(() => {
    if (sessionList.length === 0) return;
    navigateToSession(sessionList[0].id);
  }, [sessionList, navigateToSession]);

  const taskTrackerSession = taskTrackerId ? sessions.get(taskTrackerId) : null;

  // Dialog left edge in px (dialog is 900px centered)
  const dialogLeftEdge = typeof window !== 'undefined'
    ? (window.innerWidth - 900) / 2
    : 200;
  const spriteCenterY = typeof window !== 'undefined' ? window.innerHeight / 2 : 300;

  return (
    <>
      <HeaderBar
        connected={connected}
        sessionCount={sessions.size}
        onSetupClick={() => setShowSetup(true)}
        onTasksClick={() => setShowTaskBoard(true)}
        onResumeClick={() => setShowResume(true)}
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

      {/* Darkened backdrop for office view when dialog is open */}
      {viewMode === 'office' && selectedSessionId && (
        <div
          onClick={handleCloseDialog}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.55)',
            zIndex: 90,
            transition: 'opacity 0.3s ease',
            opacity: spriteAnimated ? 1 : 0,
          }}
        />
      )}

      {/* Floating sprite animation (office view only) */}
      {viewMode === 'office' && floatingSprite && selectedSessionId && (
        <FloatingSprite
          dataURL={floatingSprite.dataURL}
          name={floatingSprite.name}
          color={floatingSprite.color}
          startX={floatingSprite.startX}
          startY={floatingSprite.startY}
          boundaryRight={dialogLeftEdge}
          targetY={spriteCenterY}
          animated={spriteAnimated}
        />
      )}

      {/* Session dialog — used in both views */}
      <SessionDialog
        sessionId={selectedSessionId}
        sessions={sessions}
        onClose={viewMode === 'office' ? handleCloseDialog : () => setSelectedSessionId(null)}
        isTaskTracker={selectedSessionId ? selectedSessionId === taskTrackerId : false}
        onSetTaskTracker={handleSetTaskTracker}
        noBackdrop={viewMode === 'office'}
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
