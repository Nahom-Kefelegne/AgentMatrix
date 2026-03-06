'use client';

import { useState, useCallback } from 'react';
import type { CharacterData } from '@/lib/types';
import { SocketProvider, useSocketContext } from './components/SocketProvider';
import HeaderBar from './components/HeaderBar';
import OfficeCanvas from './components/OfficeCanvas';
import HoverCard from './components/HoverCard';
import SidePanel from './components/SidePanel';
import SetupModal from './components/SetupModal';

function OfficeView() {
  const { connected, sessions, onEvent } = useSocketContext();

  const [hoveredChar, setHoveredChar] = useState<CharacterData | null>(null);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });
  const [selectedChar, setSelectedChar] = useState<CharacterData | null>(null);
  const [showSetup, setShowSetup] = useState(false);

  const handleHover = useCallback((char: CharacterData | null, screenX: number, screenY: number) => {
    setHoveredChar(char);
    setHoverPos({ x: screenX, y: screenY });
  }, []);

  const handleClick = useCallback((char: CharacterData | null) => {
    setSelectedChar(char);
  }, []);

  return (
    <>
      <HeaderBar connected={connected} onSetupClick={() => setShowSetup(true)} />
      <OfficeCanvas
        sessions={sessions}
        onEvent={onEvent}
        onHover={handleHover}
        onClick={handleClick}
      />
      <HoverCard character={hoveredChar} x={hoverPos.x} y={hoverPos.y} />
      <SidePanel character={selectedChar} onClose={() => setSelectedChar(null)} />
      <SetupModal
        isOpen={showSetup}
        onClose={() => setShowSetup(false)}
        connected={connected}
        sessionCount={sessions.size}
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
