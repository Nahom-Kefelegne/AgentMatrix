'use client';

import React, { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { CANVAS_W, CANVAS_H, DISPLAY_W, DISPLAY_H, SCALE } from '@/lib/constants';
import { SOCKET_EVENTS } from '@/lib/types';
import type { SessionData, AgentData, CharacterData } from '@/lib/types';
import type { SocketEventHandler } from '@/lib/hooks/useSocket';

interface OfficeCanvasProps {
  sessions: Map<string, SessionData>;
  onEvent: (cb: (handler: SocketEventHandler) => void) => () => void;
  onHover: (char: CharacterData | null, screenX: number, screenY: number) => void;
  onClick: (char: CharacterData | null) => void;
  scrollToId?: string | null;
}

export interface OfficeCanvasHandle {
  getCharacterScreenInfo: (id: string) => {
    screenX: number; screenY: number; spriteDataURL: string; name: string; color: string;
  } | null;
}

const OfficeCanvas = forwardRef<OfficeCanvasHandle, OfficeCanvasProps>(function OfficeCanvas(
  { sessions, onEvent, onHover, onClick, scrollToId },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const engineRef = useRef<any>(null);
  const initializedRef = useRef(false);
  const eventBufferRef = useRef<SocketEventHandler[]>([]);
  const engineReadyRef = useRef(false);

  const processEvent = useCallback((handler: SocketEventHandler) => {
    const engine = engineRef.current;
    if (!engine) return;

    switch (handler.event) {
      case SOCKET_EVENTS.STATE_SNAPSHOT: {
        const snapshot = handler.data as SessionData[];
        snapshot.forEach(session => {
          engine.spawnCharacter(session);
          if (session.status === 'idle') {
            engine.showEmoji(session.id, '💤', true);
          }
        });
        break;
      }
      case SOCKET_EVENTS.SESSION_START: {
        const session = handler.data as SessionData;
        engine.spawnCharacter(session);
        if (session.status === 'idle') {
          engine.showEmoji(session.id, '💤', true);
        }
        break;
      }
      case SOCKET_EVENTS.SESSION_END: {
        const data = handler.data as { sessionId: string };
        engine.removeCharacter(data.sessionId);
        break;
      }
      case 'session:fired': {
        const data = handler.data as { sessionId: string };
        engine.fireCharacter(data.sessionId);
        break;
      }
      case SOCKET_EVENTS.SESSION_UPDATE: {
        const data = handler.data as { sessionId: string; changes: Partial<SessionData> };
        const charBefore = engine.getCharacterManager().getCharacter(data.sessionId);
        const wasInMeeting = charBefore?.status === 'meeting';
        const goingIdle = data.changes.status === 'idle';

        if (wasInMeeting && goingIdle) {
          engine.updateCharacter(data.sessionId, data.changes);
          engine.returnToDeskAfterMeeting(data.sessionId);
          engine.showEmoji(data.sessionId, '✅');
        } else if (wasInMeeting && data.changes.status && data.changes.status !== 'meeting') {
          const { status, ...rest } = data.changes;
          engine.updateCharacter(data.sessionId, rest);
        } else {
          engine.updateCharacter(data.sessionId, data.changes);
          // Show zzz when session goes idle (persistent until they work again)
          if (data.changes.status === 'idle') {
            engine.showEmoji(data.sessionId, '💤', true);
          }
        }
        break;
      }
      case SOCKET_EVENTS.TOOL_START: {
        const data = handler.data as { sessionId: string; agentName?: string | null; toolName: string };
        // Find the character: by agent name if it's an agent, otherwise by session ID
        const cm = engine.getCharacterManager();
        const targetChar = data.agentName
          ? cm.findByName(data.agentName)
          : cm.getCharacter(data.sessionId);

        if (targetChar) {
          const newStatus = targetChar.status === 'meeting' ? 'meeting' : 'working';
          engine.updateCharacter(targetChar.id, { currentTool: data.toolName, status: newStatus });
          engine.clearEmoji(targetChar.id); // clear idle indicator when working
          if (targetChar.status === 'meeting') {
            engine.showChatBubble(targetChar.id, data.toolName);
          }
        } else {
          engine.updateCharacter(data.sessionId, { currentTool: data.toolName, status: 'working' });
          engine.clearEmoji(data.sessionId);
        }
        break;
      }
      case SOCKET_EVENTS.TOOL_COMPLETE: {
        const data = handler.data as { sessionId: string; agentName?: string | null; toolName: string; summary: string };
        const cm2 = engine.getCharacterManager();
        const completeChar = data.agentName
          ? cm2.findByName(data.agentName)
          : cm2.getCharacter(data.sessionId);
        if (completeChar) {
          engine.updateCharacter(completeChar.id, { currentTool: undefined });
        } else {
          engine.updateCharacter(data.sessionId, { currentTool: undefined });
        }
        break;
      }
      case SOCKET_EVENTS.AGENT_START: {
        const data = handler.data as { sessionId: string; agent: AgentData };
        const teamId = data.agent.teamName || `team-${data.sessionId.slice(0, 6)}`;
        engine.spawnAgent(data.sessionId, data.agent, teamId);
        break;
      }
      case SOCKET_EVENTS.AGENT_STOP: {
        const data = handler.data as { sessionId: string; agentId: string; agentName?: string };
        // Try by ID first, then by name
        const cm3 = engine.getCharacterManager();
        const stopChar = cm3.getCharacter(data.agentId)
          || (data.agentName ? cm3.findByName(data.agentName) : undefined);
        if (stopChar) {
          engine.removeAgent(data.sessionId, stopChar.id);
        }
        break;
      }
      case SOCKET_EVENTS.MEETING_START: {
        const data = handler.data as { teamId: string; participantIds: string[] };
        engine.startMeeting(data.teamId, data.participantIds);
        break;
      }
      case SOCKET_EVENTS.MEETING_MESSAGE: {
        const data = handler.data as { fromId: string; toId: string; summary?: string };
        engine.drawConnectionLine(data.fromId, data.toId);
        engine.showChatBubble(data.fromId, data.summary || '...');
        break;
      }
    }
  }, []);

  // Subscribe to socket events immediately (before engine init)
  const handleSocketEvent = useCallback((handler: SocketEventHandler) => {
    if (engineReadyRef.current) {
      processEvent(handler);
    } else {
      // Buffer until engine is ready
      eventBufferRef.current.push(handler);
    }
  }, [processEvent]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || initializedRef.current) return;
    initializedRef.current = true;

    // Subscribe to events immediately so we don't miss the snapshot
    const unsubscribe = onEvent(handleSocketEvent);
    let stopped = false;

    (async () => {
      const { GameEngine } = await import('@/lib/engine/GameEngine');
      const engine = new GameEngine(canvas, overlayRef.current || undefined);
      engineRef.current = engine;

      await engine.init();
      if (stopped) return;
      engine.start();

      engine.setOnHover(onHover);
      engine.setOnClick(onClick);

      // Replay buffered events
      engineReadyRef.current = true;
      for (const event of eventBufferRef.current) {
        processEvent(event);
      }
      eventBufferRef.current = [];

      // Also spawn from current sessions state as fallback
      sessions.forEach(session => {
        engine.spawnCharacter(session);
        if (session.status === 'idle') {
          engine.showEmoji(session.id, '💤', true);
        }
      });
    })();

    return () => {
      stopped = true;
      unsubscribe();
      engineRef.current?.stop();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Expose engine methods to parent via ref
  useImperativeHandle(ref, () => ({
    getCharacterScreenInfo: (id: string) => {
      return engineRef.current?.getCharacterScreenInfo?.(id) ?? null;
    },
  }), []);

  // Highlight selected character
  useEffect(() => {
    if (engineRef.current && engineReadyRef.current && engineRef.current.highlightCharacter) {
      engineRef.current.highlightCharacter(scrollToId || null);
    }
  }, [scrollToId]);

  const getCanvasCoords = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const overlay = overlayRef.current;
    if (!overlay) return null;
    const rect = overlay.getBoundingClientRect();
    return {
      canvasX: (e.clientX - rect.left) / SCALE,
      canvasY: (e.clientY - rect.top) / SCALE,
      screenX: e.clientX,
      screenY: e.clientY,
    };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const engine = engineRef.current;
    const coords = getCanvasCoords(e);
    if (!engine || !coords) return;
    engine.handleMouseMove(coords.canvasX, coords.canvasY, coords.screenX, coords.screenY);
  }, [getCanvasCoords]);

  const mouseDownPos = useRef<{ x: number; y: number } | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const engine = engineRef.current;
    const coords = getCanvasCoords(e);
    if (!engine || !coords) return;
    mouseDownPos.current = { x: e.clientX, y: e.clientY };
    engine.handleMouseDown(coords.canvasX, coords.canvasY);
  }, [getCanvasCoords]);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const engine = engineRef.current;
    const coords = getCanvasCoords(e);
    if (!engine || !coords) return;
    engine.handleMouseUp(coords.canvasX, coords.canvasY);
    // Only trigger click if mouse didn't move much (not a drag)
    if (mouseDownPos.current) {
      const dx = Math.abs(e.clientX - mouseDownPos.current.x);
      const dy = Math.abs(e.clientY - mouseDownPos.current.y);
      if (dx < 5 && dy < 5) {
        engine.handleMouseClick(coords.canvasX, coords.canvasY);
      }
    }
    mouseDownPos.current = null;
  }, [getCanvasCoords]);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100vw',
        height: '100vh',
        paddingTop: 'var(--header-height)',
        overflow: 'auto',
      }}
    >
      <div style={{ position: 'relative', width: DISPLAY_W, height: DISPLAY_H }}>
        {/* Pixel art layer */}
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: DISPLAY_W,
            height: DISPLAY_H,
            imageRendering: 'pixelated',
          }}
        />
        {/* Crisp text overlay */}
        <canvas
          ref={overlayRef}
          width={DISPLAY_W}
          height={DISPLAY_H}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: DISPLAY_W,
            height: DISPLAY_H,
            cursor: 'pointer',
          }}
        />
      </div>
    </div>
  );
});

export default OfficeCanvas;
