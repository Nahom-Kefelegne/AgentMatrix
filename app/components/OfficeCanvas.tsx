'use client';

import React, {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { CANVAS_W, CANVAS_H, SCALE } from '@/lib/constants';
import { SOCKET_EVENTS } from '@/lib/types';
import type { SessionData, AgentData, CharacterData } from '@/lib/types';
import type { SocketEventHandler } from '@/lib/hooks/useSocket';
import { perfEvent, perfSpan } from '@/lib/perf';

interface OfficeCanvasProps {
  sessions: Map<string, SessionData>;
  onEvent: (cb: (handler: SocketEventHandler) => void) => () => void;
  onHover: (char: CharacterData | null, screenX: number, screenY: number) => void;
  onClick: (char: CharacterData | null) => void;
  scrollToId?: string | null;
}

interface CanvasDisplay {
  width: number;
  height: number;
  overlayWidth: number;
  overlayHeight: number;
}

const MAX_EVENT_BUFFER = 500;
const INITIAL_DISPLAY: CanvasDisplay = {
  width: CANVAS_W,
  height: CANVAS_H,
  overlayWidth: CANVAS_W,
  overlayHeight: CANVAS_H,
};

function OfficeCanvas({
  sessions,
  onEvent,
  onHover,
  onClick,
  scrollToId,
}: OfficeCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const engineRef = useRef<any>(null);
  const initializedRef = useRef(false);
  const eventBufferRef = useRef<SocketEventHandler[]>([]);
  const engineReadyRef = useRef(false);
  const sessionsRef = useRef(sessions);
  const onHoverRef = useRef(onHover);
  const onClickRef = useRef(onClick);
  const [display, setDisplay] = useState<CanvasDisplay>(INITIAL_DISPLAY);
  const displayRef = useRef(display);
  sessionsRef.current = sessions;
  onHoverRef.current = onHover;
  onClickRef.current = onClick;
  displayRef.current = display;

  const processEvent = useCallback((handler: SocketEventHandler) => {
    const engine = engineRef.current;
    if (!engine) return;

    switch (handler.event) {
      case SOCKET_EVENTS.STATE_SNAPSHOT: {
        const snapshot = handler.data as SessionData[];
        engine.hydrateSessions(snapshot);
        break;
      }
      case SOCKET_EVENTS.SESSION_START: {
        const session = handler.data as SessionData;
        engine.spawnCharacter(session);
        if (session.status === 'idle') {
          engine.showEmoji(session.id, '💤', true);
        } else if (session.status === 'attention') {
          engine.showEmoji(session.id, '✋', true);
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
          engine.updateCharacter(data.sessionId, { ...data.changes, currentTool: undefined });
          engine.returnToDeskAfterMeeting(data.sessionId);
          engine.showEmoji(data.sessionId, '✅');
        } else if (wasInMeeting && data.changes.status && data.changes.status !== 'meeting') {
          const { status, ...rest } = data.changes;
          engine.updateCharacter(data.sessionId, rest);
        } else {
          engine.updateCharacter(data.sessionId, data.changes);
          if (data.changes.status === 'idle') {
            engine.updateCharacter(data.sessionId, { currentTool: undefined });
            engine.showEmoji(data.sessionId, '💤', true);
          } else if (data.changes.status === 'working') {
            engine.clearEmoji(data.sessionId);
          } else if (data.changes.status === 'attention') {
            engine.showEmoji(data.sessionId, '✋', true);
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
      if (eventBufferRef.current.length >= MAX_EVENT_BUFFER) {
        eventBufferRef.current.shift();
      }
      eventBufferRef.current.push(handler);
    }
  }, [processEvent]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = () => {
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const displayScale = Math.max(
        0.25,
        Math.min(SCALE, rect.width / CANVAS_W, rect.height / CANVAS_H),
      );
      const width = Math.max(1, Math.floor(CANVAS_W * displayScale));
      const height = Math.max(1, Math.floor(CANVAS_H * displayScale));
      const overlayWidth = width;
      const overlayHeight = height;
      setDisplay(previous => (
        previous.width === width
        && previous.height === height
        && previous.overlayWidth === overlayWidth
        && previous.overlayHeight === overlayHeight
          ? previous
          : { width, height, overlayWidth, overlayHeight }
      ));
    };
    const observer = new ResizeObserver(update);
    observer.observe(container);
    update();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || initializedRef.current) return;
    initializedRef.current = true;

    // Subscribe to events immediately so we don't miss the snapshot
    const unsubscribe = onEvent(handleSocketEvent);
    let stopped = false;
    let unsubscribeVisibility: (() => void) | undefined;
    const endInitSpan = perfSpan('office:first-paint', 50);
    perfEvent('office:mount');

    (async () => {
      const { GameEngine } = await import('@/lib/engine/GameEngine');
      if (stopped) return;
      const engine = new GameEngine(canvas, overlayRef.current || undefined, {
        reducedMotion: document.documentElement.classList.contains('reduce-motion'),
      });
      engineRef.current = engine;

      engine.setOnHover((character, screenX, screenY) => {
        onHoverRef.current(character, screenX, screenY);
      });
      engine.setOnClick(character => onClickRef.current(character));
      engine.resizeOverlay(
        displayRef.current.overlayWidth,
        displayRef.current.overlayHeight,
      );
      engine.hydrateSessions(sessionsRef.current.values());

      // Replay buffered events
      engineReadyRef.current = true;
      for (const event of eventBufferRef.current) {
        processEvent(event);
      }
      eventBufferRef.current = [];
      engine.start();
      endInitSpan();
      void engine.loadAssets();

      const electronAPI = (window as any).electronAPI;
      const cleanup = electronAPI?.onWindowVisibilityChange?.((visible: boolean) => {
        engine.setSuspended(!visible);
      });
      if (typeof cleanup === 'function') unsubscribeVisibility = cleanup;
      const visible = await electronAPI?.getWindowVisibility?.();
      if (visible === false) engine.setSuspended(true);
    })();

    return () => {
      stopped = true;
      unsubscribe();
      unsubscribeVisibility?.();
      engineReadyRef.current = false;
      eventBufferRef.current = [];
      engineRef.current?.stop();
      engineRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    engineRef.current?.resizeOverlay(display.overlayWidth, display.overlayHeight);
  }, [display.overlayHeight, display.overlayWidth]);

  // Sprite state is driven by SESSION_UPDATE / TOOL_START / TOOL_COMPLETE events
  // processed in processEvent above — no separate session:state listener needed.

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
      canvasX: (e.clientX - rect.left) * CANVAS_W / rect.width,
      canvasY: (e.clientY - rect.top) * CANVAS_H / rect.height,
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

  const handleMouseLeave = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    onHoverRef.current(null, e.clientX, e.clientY);
  }, []);

  return (
    <div
      ref={containerRef}
      className="office-canvas-root"
      role="img"
      aria-label={`Interactive Office map with ${sessions.size} active session${sessions.size === 1 ? '' : 's'}`}
    >
      <div
        className="office-canvas-frame"
        style={{ width: display.width, height: display.height }}
      >
        {/* Pixel art layer */}
        <canvas
          className="office-pixel-canvas"
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: display.width,
            height: display.height,
            imageRendering: 'pixelated',
          }}
        />
        {/* Crisp text overlay */}
        <canvas
          className="office-overlay-canvas"
          ref={overlayRef}
          width={display.overlayWidth}
          height={display.overlayHeight}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: display.width,
            height: display.height,
            cursor: 'pointer',
          }}
        />
      </div>
    </div>
  );
}

export default memo(OfficeCanvas);
