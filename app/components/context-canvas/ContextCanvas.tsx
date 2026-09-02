'use client';

import dynamic from 'next/dynamic';
import { useCallback, useMemo, useRef } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Code2,
  LockKeyhole,
  PanelRightClose,
  Pin,
  PinOff,
} from 'lucide-react';
import {
  artifactCreatedLabel,
  artifactIsRenderable,
  artifactSourceLabel,
  artifactSummary,
  artifactTitle,
  artifactRenderer,
  navigationRequestForArtifact,
} from './canvasArtifact';
import type {
  ChangesCanvasRequest,
  DecisionCanvasRequest,
  LocationsCanvasRequest,
  PlanCanvasRequest,
} from '@/lib/canvas/types';
import { isRepositorySearchAction } from '@/lib/navigation/types';
import type { ContextCanvasController } from './useContextCanvas';

const CodePreview = dynamic(() => import('./CodePreview'), {
  ssr: false,
  loading: () => <div className="cc-loading" role="status">Loading code preview…</div>,
});

const MarkdownPreview = dynamic(() => import('./MarkdownPreview'), {
  ssr: false,
  loading: () => <div className="cc-loading" role="status">Loading document preview…</div>,
});

const DiffCanvas = dynamic(() => import('./DiffCanvas'), {
  ssr: false,
  loading: () => <div className="cc-loading" role="status">Loading session review…</div>,
});

const LocationsArtifact = dynamic(() => import('./LocationsArtifact'), {
  ssr: false,
  loading: () => <div className="cc-loading" role="status">Loading locations…</div>,
});

const DecisionArtifact = dynamic(() => import('./DecisionArtifact'), {
  ssr: false,
  loading: () => <div className="cc-loading" role="status">Loading decision…</div>,
});

const PlanArtifact = dynamic(() => import('./PlanArtifact'), {
  ssr: false,
  loading: () => <div className="cc-loading" role="status">Loading plan…</div>,
});

interface ContextCanvasProps {
  sessionId: string;
  sessionName: string;
  cwd?: string;
  controller: ContextCanvasController;
}

function CanvasEmpty({
  queuedCount,
  hasRenderableQueue,
}: {
  queuedCount: number;
  hasRenderableQueue: boolean;
}) {
  if (queuedCount > 0) {
    return (
      <div className="cc-empty">
        <Code2 size={24} aria-hidden="true" />
        <strong>{queuedCount} Queued Canvas {queuedCount === 1 ? 'Artifact' : 'Artifacts'}</strong>
        <span>
          {hasRenderableQueue
            ? 'Open the queued item from the Canvas toolbar.'
            : 'These artifacts are retained and will become available as their Canvas components are added.'}
        </span>
      </div>
    );
  }
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
  const artifact = state.activeArtifact;
  const request = useMemo(
    () => navigationRequestForArtifact(artifact),
    [artifact],
  );
  const renderer = artifact ? artifactRenderer(artifact) : null;
  const title = artifactTitle(artifact);
  const createdLabel = artifactCreatedLabel(artifact);
  const nextQueued = state.queuedArtifacts.find(artifactIsRenderable);
  const locationsRequest: LocationsCanvasRequest | null =
    artifact?.type === 'typed' && artifact.request.kind === 'locations'
      ? artifact.request
      : null;
  const decisionRequest: DecisionCanvasRequest | null =
    artifact?.type === 'typed' && artifact.request.kind === 'decision'
      ? artifact.request
      : null;
  const planRequest: PlanCanvasRequest | null =
    artifact?.type === 'typed' && artifact.request.kind === 'plan'
      ? artifact.request
      : null;
  const changesRequest: ChangesCanvasRequest | null =
    artifact?.type === 'typed' && artifact.request.kind === 'changes'
      ? artifact.request
      : null;
  const disabledSearch =
    artifact?.type === 'navigation'
    && isRepositorySearchAction(artifact.request.action);

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
          <strong title={title}>{title}</strong>
        </div>

        <div className="cc-toolbar-actions">
          {state.queuedArtifacts.length > 0 ? (
            <button
              type="button"
              className="cc-queued"
              onClick={() => {
                if (nextQueued) controller.showQueued(nextQueued.request.requestRef);
              }}
              disabled={!nextQueued}
              aria-label={nextQueued
                ? `Show next of ${state.queuedArtifacts.length} queued Canvas artifacts`
                : `${state.queuedArtifacts.length} queued Canvas artifacts await their components`}
              title={nextQueued ? 'Show Queued Request' : 'Queued artifacts await their components'}
            >
              {state.queuedArtifacts.length}
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
        <span className="cc-provenance-source">{artifactSourceLabel(artifact)}</span>
        <span className="cc-provenance-summary">{artifactSummary(artifact)}</span>
        {createdLabel ? (
          <time
            className="cc-provenance-time"
            dateTime={new Date(artifact!.request.createdAt).toISOString()}
            suppressHydrationWarning
          >
            {createdLabel}
          </time>
        ) : null}
        {state.disposition === 'pinned' ? (
          <span className="cc-provenance-pin">
            <LockKeyhole size={11} aria-hidden="true" /> Pinned
          </span>
        ) : null}
      </div>

      <div className="cc-content">
        {!artifact ? (
          <CanvasEmpty
            queuedCount={state.queuedArtifacts.length}
            hasRenderableQueue={Boolean(nextQueued)}
          />
        ) : null}
        {disabledSearch ? (
          <div className="cc-empty">
            <Code2 size={24} aria-hidden="true" />
            <strong>Repository Search Disabled</strong>
            <span>Ask the session to investigate, then present exact verified locations.</span>
          </div>
        ) : null}
        {request && renderer === 'code' ? <CodePreview request={request} /> : null}
        {request && renderer === 'document' ? (
          <MarkdownPreview request={request} controller={controller} />
        ) : null}
        {locationsRequest && renderer === 'locations' ? (
          <LocationsArtifact
            key={locationsRequest.requestRef}
            request={locationsRequest}
            onOpenLocation={controller.openCode}
          />
        ) : null}
        {decisionRequest && renderer === 'decision' ? (
          <DecisionArtifact
            key={decisionRequest.requestRef}
            request={decisionRequest}
            onResolved={controller.resolveDecision}
          />
        ) : null}
        {planRequest && renderer === 'plan' ? (
          <PlanArtifact key={planRequest.sessionId} request={planRequest} />
        ) : null}
        {request && (renderer === 'diff' || renderer === 'review') ? (
          <DiffCanvas
            key={request.requestRef}
            sessionId={sessionId}
            sessionName={sessionName}
            cwd={cwd}
            request={request}
            canvasRequest={changesRequest}
            controller={controller}
          />
        ) : null}
      </div>

      <footer className="cc-footer">
        <button type="button" onClick={controller.backToConversation}>
          Back to Conversation
        </button>
      </footer>
    </aside>
  );
}
