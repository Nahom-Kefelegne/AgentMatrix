'use client';

import { ArrowRight, Bot, Terminal } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { CharacterData, SessionData } from '@/lib/types';
import type { SocketEventHandler } from '@/lib/hooks/useSocket';
import CliIcon from '../CliIcon';
import HoverCard from '../HoverCard';
import OfficeCanvas from '../OfficeCanvas';

interface OfficeWorkspaceProps {
  sessions: Map<string, SessionData>;
  onEvent: (cb: (handler: SocketEventHandler) => void) => () => void;
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onOpenSession: (sessionId: string) => void;
  legacy?: boolean;
}

function hoverSignature(character: CharacterData | null): string {
  if (!character) return '';
  const latestAction = character.recentActions[0];
  return [
    character.id,
    character.status,
    character.currentTool ?? '',
    character.lastToolSummary ?? '',
    character.lastActivity ?? 0,
    latestAction?.timestamp ?? 0,
  ].join(':');
}

export default function OfficeWorkspace({
  sessions,
  onEvent,
  selectedSessionId,
  onSelectSession,
  onOpenSession,
  legacy = false,
}: OfficeWorkspaceProps) {
  const hoverCardRef = useRef<HTMLDivElement>(null);
  const hoverSignatureRef = useRef('');
  const hoverPositionRef = useRef({ x: 0, y: 0 });
  const [hoveredCharacter, setHoveredCharacter] = useState<CharacterData | null>(null);
  const selectedSession = selectedSessionId
    ? sessions.get(selectedSessionId) ?? null
    : null;
  const ownerByCharacter = useMemo(() => {
    const owners = new Map<string, string>();
    for (const session of sessions.values()) {
      owners.set(session.id, session.id);
      for (const agent of session.agents) {
        owners.set(agent.id, session.id);
        if (!owners.has(agent.name)) owners.set(agent.name, session.id);
      }
    }
    return owners;
  }, [sessions]);

  const positionHoverCard = useCallback((x: number, y: number) => {
    hoverPositionRef.current = { x, y };
    if (hoverCardRef.current) {
      hoverCardRef.current.style.transform = `translate3d(${Math.round(x + 16)}px, ${Math.round(y + 16)}px, 0)`;
    }
  }, []);

  const handleHover = useCallback((character: CharacterData | null, x: number, y: number) => {
    positionHoverCard(x, y);
    const signature = hoverSignature(character);
    if (signature === hoverSignatureRef.current) return;
    hoverSignatureRef.current = signature;
    setHoveredCharacter(character);
    window.requestAnimationFrame(() => {
      positionHoverCard(hoverPositionRef.current.x, hoverPositionRef.current.y);
    });
  }, [positionHoverCard]);

  const handleCharacterClick = useCallback((character: CharacterData | null) => {
    if (!character) return;
    const ownerId = ownerByCharacter.get(character.id)
      ?? ownerByCharacter.get(character.name);
    if (ownerId) onSelectSession(ownerId);
  }, [onSelectSession, ownerByCharacter]);

  return (
    <main
      id="mc-office-workspace"
      className={`mc-office-workspace ${legacy ? 'mc-office-workspace--legacy' : ''}`}
      tabIndex={-1}
    >
      <div className="mc-office-map">
        <OfficeCanvas
          sessions={sessions}
          onEvent={onEvent}
          onHover={handleHover}
          onClick={handleCharacterClick}
          scrollToId={selectedSessionId}
        />
        <HoverCard
          ref={hoverCardRef}
          character={hoveredCharacter}
        />
      </div>

      <footer className="mc-office-selection">
        {selectedSession ? (
          <>
            <div className="mc-office-selection-identity">
              <span className={`mc-live-dot mc-live-dot--${selectedSession.status}`} aria-hidden="true" />
              <div>
                <strong translate="no">
                  <CliIcon cliType={selectedSession.cliType} />
                  {selectedSession.name}
                </strong>
                <span>
                  {selectedSession.status}
                  {selectedSession.currentTool ? ` - ${selectedSession.currentTool}` : ''}
                </span>
              </div>
            </div>
            <div className="mc-office-selection-meta">
              <span><Bot size={13} aria-hidden="true" /> {selectedSession.agents.length} subagents</span>
              <span title={selectedSession.cwd}><Terminal size={13} aria-hidden="true" /> {selectedSession.cwd || 'No working directory'}</span>
            </div>
            <button type="button" className="mc-button mc-office-open" onClick={() => onOpenSession(selectedSession.id)}>
              Open CLI <ArrowRight size={14} aria-hidden="true" />
            </button>
          </>
        ) : (
          <div className="mc-office-selection-empty">
            Select a session from the rail or the Office map.
          </div>
        )}
      </footer>
    </main>
  );
}
