'use client';

import dynamic from 'next/dynamic';
import { useCallback, useRef } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Code2,
  GitCompareArrows,
  LockKeyhole,
  PanelRightClose,
  Pin,
  PinOff,
  Search,
} from 'lucide-react';
import type { NavigationRequest } from '@/lib/navigation/types';
import type { ContextCanvasController } from './useContextCanvas';

const CodePreview = dynamic(() => import('./CodePreview'), {
  ssr: false,
  loading: () => <div className="cc-loading" role="status">Loading code preview…</div>,
});

const SearchResults = dynamic(() => import('./SearchResults'), {
  ssr: false,
  loading: () => <div className="cc-loading" role="status">Loading search…</div>,
});

const MarkdownPreview = dynamic(() => import('./MarkdownPreview'), {
  ssr: false,
  loading: () => <div className="cc-loading" role="status">Loading document preview…</div>,
});

const DiffCanvas = dynamic(() => import('./DiffCanvas'), {
  ssr: false,
  loading: () => <div className="cc-loading" role="status">Loading session review…</div>,
});

interface ContextCanvasProps {
  sessionId: string;
  sessionName: string;
  cwd?: string;
  controller: ContextCanvasController;
}

function canvasTitle(request: NavigationRequest | null): string {
  if (!request) return 'Context Canvas';
  if (request.action === 'open_review' || request.action === 'open_diff') return 'Session Review';
  if (request.action === 'open_symbol') return request.query ? `Symbol: ${request.query}` : 'Symbol Search';
  if (request.action === 'show_search_results') return request.query ? `Search: ${request.query}` : 'Repository Search';
  return request.target?.path ?? 'Code Preview';
}

function CanvasEmpty() {
  return (
    <div className="cc-empty">
      <Code2 size={24} aria-hidden="true" />
      <strong>Reveal Repository Context</strong>
      <span>Ask the CLI to show code, click a terminal file link, or open a session diff.</span>
    </div>
  );
}

export default function ContextCanvas({ sessionId, sessionName, cwd, controller }: ContextCanvasProps) {
  const canvasRef = useRef<HTMLElement>(null);
  const frameRef = useRef<number | null>(null);
  const { state } = controller;
  const request = state.request;

  const handleResizeStart = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const canvas = canvasRef.current;
    const surface = canvas?.parentElement;
    if (!canvas || !surface) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = canvas.getBoundingClientRect().width;
    const surfaceWidth = surface.getBoundingClientRect().width;
    const minWidth = Math.min(320, surfaceWidth * 0.45);
    const maxWidth = surfaceWidth * 0.7;

    const handleMove = (moveEvent: PointerEvent) => {
      const width = Math.max(minWidth, Math.min(maxWidth, startWidth + startX - moveEvent.clientX));
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(() => {
        surface.style.setProperty('--mc-canvas-width', `${Math.round(width)}px`);
      });
    };
    const handleEnd = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleEnd);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleEnd, { once: true });
  }, []);

  const handleResizeKeyDown = useCallback((event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const canvas = canvasRef.current;
    const surface = canvas?.parentElement;
    if (!canvas || !surface) return;
    event.preventDefault();
    const surfaceWidth = surface.getBoundingClientRect().width;
    const currentWidth = canvas.getBoundingClientRect().width;
    const direction = event.key === 'ArrowLeft' ? 1 : -1;
    const width = Math.max(
      Math.min(320, surfaceWidth * 0.45),
      Math.min(surfaceWidth * 0.7, currentWidth + direction * 24),
    );
    surface.style.setProperty('--mc-canvas-width', `${Math.round(width)}px`);
  }, []);

  const canBack = state.historyIndex > 0;
  const canForward = state.historyIndex >= 0 && state.historyIndex < state.history.length - 1;

  return (
    <aside ref={canvasRef} className="cc-canvas" aria-label={`Context Canvas for ${sessionName}`}>
      <button
        type="button"
        className="cc-resize-handle"
        onPointerDown={handleResizeStart}
        onKeyDown={handleResizeKeyDown}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize Context Canvas"
        title="Drag to Resize"
      />

      <header className="cc-toolbar">
        <div className="cc-history-controls">
          <button type="button" onClick={controller.back} disabled={!canBack} aria-label="Back" title="Back">
            <ArrowLeft size={14} aria-hidden="true" />
          </button>
          <button type="button" onClick={controller.forward} disabled={!canForward} aria-label="Forward" title="Forward">
            <ArrowRight size={14} aria-hidden="true" />
          </button>
        </div>

        <div className="cc-title">
          <span className="cc-title-label">Context Canvas</span>
          <strong title={canvasTitle(request)}>{canvasTitle(request)}</strong>
        </div>

        <div className="cc-toolbar-actions">
          {state.queuedRequests.length > 0 ? (
            <button
              type="button"
              className="cc-queued"
              onClick={() => controller.showQueued(state.queuedRequests[0].requestRef)}
              aria-label={`Show ${state.queuedRequests.length} queued navigation requests`}
              title="Show Queued Request"
            >
              {state.queuedRequests.length}
            </button>
          ) : null}
          <button
            type="button"
            onClick={controller.togglePin}
            aria-label={state.disposition === 'pinned' ? 'Unpin Canvas' : 'Pin Canvas'}
            title={state.disposition === 'pinned' ? 'Unpin Canvas' : 'Pin Canvas'}
          >
            {state.disposition === 'pinned'
              ? <PinOff size={14} aria-hidden="true" />
              : <Pin size={14} aria-hidden="true" />}
          </button>
          <button type="button" onClick={controller.close} aria-label="Close Context Canvas" title="Close Canvas">
            <PanelRightClose size={15} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="cc-provenance">
        <span>{
          request?.source === 'mcp'
            ? 'Opened by Session'
            : request?.source === 'session_event'
              ? 'Auto-preview from Session'
              : request?.source === 'terminal_link'
                ? 'Terminal Link'
                : 'Developer Opened'
        }</span>
        <span>{request?.intent.summary ?? 'Session-scoped preview'}</span>
        {state.disposition === 'pinned' ? <span><LockKeyhole size={11} aria-hidden="true" /> Pinned</span> : null}
      </div>

      <div className="cc-content">
        {!request ? <CanvasEmpty /> : null}
        {request && state.mode === 'code' ? <CodePreview request={request} /> : null}
        {request && state.mode === 'document' ? (
          <MarkdownPreview request={request} controller={controller} />
        ) : null}
        {request && state.mode === 'search' ? (
          <SearchResults request={request} onOpenFile={controller.openFile} />
        ) : null}
        {request && (state.mode === 'diff' || state.mode === 'review') ? (
          <DiffCanvas
            sessionId={sessionId}
            sessionName={sessionName}
            cwd={cwd}
            request={request}
            controller={controller}
          />
        ) : null}
      </div>

      <footer className="cc-footer">
        <div className="cc-footer-group">
          <button type="button" onClick={() => controller.openSearch('', false)}>
            <Search size={13} aria-hidden="true" /> Search Repository
          </button>
          <button type="button" onClick={controller.openSessionDiff}>
            <GitCompareArrows size={13} aria-hidden="true" /> Review Session
          </button>
        </div>
        <button type="button" onClick={controller.backToConversation}>
          Back to Conversation
        </button>
      </footer>
    </aside>
  );
}
