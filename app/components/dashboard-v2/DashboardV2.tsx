'use client';

import {
  AlertTriangle,
  ArrowRightLeft,
  Bot,
  ChevronDown,
  Clock3,
  GitCompareArrows,
  Maximize2,
  PanelRightOpen,
  Power,
  RotateCcw,
  ScrollText,
  SlidersHorizontal,
  Terminal,
} from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { AttentionItem, LaneItem } from '@/lib/dashboard/attentionQueue';
import type { SessionData } from '@/lib/types';
import CliIcon from '../CliIcon';
import ContextCanvas from '../context-canvas/ContextCanvas';
import SessionConsole from '../SessionConsole';
import DashboardV2Nav from './DashboardV2Nav';
import type { DashboardV2ViewProps, SessionControlState } from './types';

const STATUS_LABEL: Record<SessionData['status'], string> = {
  attention: 'Needs You',
  working: 'Working',
  meeting: 'In Meeting',
  idle: 'Idle',
  done: 'Done',
};

const relativeTime = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'narrow' });
const numberFormat = new Intl.NumberFormat();

function timeAgo(timestamp?: number): string {
  if (!timestamp) return 'No activity recorded';
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 5) return relativeTime.format(0, 'second');
  if (seconds < 60) return relativeTime.format(-seconds, 'second');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return relativeTime.format(-minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return relativeTime.format(-hours, 'hour');
  return relativeTime.format(-Math.floor(hours / 24), 'day');
}

function shortPath(path?: string): string {
  if (!path) return 'No Working Directory';
  const normalized = path.replaceAll('\\', '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts.slice(-2).join('/') || path;
}

function MiniContext({ usage }: { usage: number | null }) {
  if (usage === null) return <span className="mc-console-context">Context —</span>;
  const tone = usage >= 90 ? 'critical' : usage >= 80 ? 'warning' : 'healthy';
  return (
    <span
      className="mc-console-context"
      role="progressbar"
      aria-label="Context Usage"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={usage}
    >
      <span className="mc-console-context-copy">{100 - usage}% Context Left</span>
      <span className="mc-console-context-track">
        <span className={`mc-console-context-fill mc-console-context-fill--${tone}`} style={{ width: `${Math.min(100, usage)}%` }} />
      </span>
    </span>
  );
}

function SessionPowerControl({
  session,
  state,
  available,
  onRestart,
  onEnd,
  onContinue,
}: {
  session: SessionData;
  state: SessionControlState | null;
  available: boolean;
  onRestart: (sessionId: string) => void;
  onEnd: (sessionId: string) => void;
  onContinue: (sessionId: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<'restart' | 'end' | null>(null);
  const busy = (state?.kind === 'restart' && state.phase !== 'ready')
    || state?.kind === 'end';
  const triggerLabel = !available
    ? 'Offline'
    : state?.kind === 'restart'
    ? state.phase === 'ready' ? 'Restarted' : state.phase === 'starting' ? 'Starting' : 'Stopping'
    : state?.kind === 'end'
      ? 'Ending'
      : 'Session';

  const closePanel = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    setConfirmation(null);
    if (restoreFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const inerted: Array<{ element: HTMLElement; wasInert: boolean }> = [];
    let branch: HTMLElement | null = rootRef.current;
    while (branch?.parentElement) {
      const parent: HTMLElement = branch.parentElement;
      for (const sibling of Array.from(parent.children)) {
        if (sibling === branch || !(sibling instanceof HTMLElement)) continue;
        inerted.push({ element: sibling, wasInert: sibling.inert });
        sibling.inert = true;
      }
      branch = parent;
      if (parent === document.body) break;
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        closePanel(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closePanel(true);
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLButtonElement>('button:not([disabled])'),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
      for (const { element, wasInert } of inerted) element.inert = wasInert;
    };
  }, [closePanel, open]);

  useEffect(() => {
    if (!available && open) closePanel(true);
  }, [available, closePanel, open]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [confirmation, open]);

  const runAction = () => {
    if (confirmation === 'restart') onRestart(session.id);
    if (confirmation === 'end') onEnd(session.id);
    closePanel(true);
  };

  return (
    <div ref={rootRef} className="mc-session-control">
      <button
        ref={triggerRef}
        type="button"
        className={`mc-session-control-trigger ${state?.kind === 'error' ? 'mc-session-control-trigger--error' : ''}`}
        onClick={() => {
          if (busy || !available) return;
          setOpen(value => !value);
          setConfirmation(null);
        }}
        aria-disabled={busy || !available}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${triggerLabel} controls for ${session.name}`}
        title={!available ? 'Reconnect AgentMatrix to manage this session' : 'Session Controls'}
      >
        <span
          className={`mc-session-control-led ${busy ? 'mc-session-control-led--busy' : ''} ${!available ? 'mc-session-control-led--offline' : ''}`}
          aria-hidden="true"
        />
        <Power size={14} aria-hidden="true" />
        <span className="mc-session-control-label">{triggerLabel}</span>
        {!busy ? <ChevronDown size={12} aria-hidden="true" /> : null}
      </button>

      {open ? (
        <div
          ref={panelRef}
          className="mc-session-control-panel"
          role="dialog"
          aria-modal="true"
          aria-label={`Session controls for ${session.name}`}
        >
          {confirmation ? (
            <div className={`mc-session-confirm mc-session-confirm--${confirmation}`}>
              <span className="mc-session-control-kicker">
                {confirmation === 'restart' ? 'Controlled restart' : 'End active session'}
              </span>
              <strong>
                {confirmation === 'restart' ? `Restart ${session.name}?` : `End ${session.name}?`}
              </strong>
              <p>
                {confirmation === 'restart'
                  ? 'AgentMatrix will exit the CLI cleanly, then resume it with the same model, effort, permissions, and tools.'
                  : 'The CLI will close after its transcript flushes. You can still find and resume the saved conversation later.'}
              </p>
              <div className="mc-session-confirm-actions">
                <button type="button" onClick={() => setConfirmation(null)}>Cancel</button>
                <button
                  type="button"
                  className={confirmation === 'end' ? 'mc-session-confirm-danger' : 'mc-session-confirm-primary'}
                  onClick={runAction}
                >
                  {confirmation === 'restart' ? 'Restart Session' : 'End Session'}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="mc-session-control-heading">
                <div>
                  <span className="mc-session-control-kicker">Session power</span>
                  <strong>{session.name}</strong>
                </div>
                <code>{session.id.slice(0, 8)}</code>
              </div>
              {state?.kind === 'error' ? (
                <div className="mc-session-control-error" role="alert">
                  <AlertTriangle size={14} aria-hidden="true" />
                  <span>{state.message}</span>
                </div>
              ) : null}
              <button
                type="button"
                className="mc-session-control-action"
                onClick={() => {
                  closePanel(false);
                  onContinue(session.id);
                }}
              >
                <ArrowRightLeft size={16} aria-hidden="true" />
                <span>
                  <strong>Continue in Fresh Session</strong>
                  <small>Carry selected context into a new session with the same provider profile.</small>
                </span>
              </button>
              <button
                type="button"
                className="mc-session-control-action"
                onClick={() => setConfirmation('restart')}
              >
                <RotateCcw size={16} aria-hidden="true" />
                <span>
                  <strong>Restart Session</strong>
                  <small>Clean exit, then resume the same conversation and launch profile.</small>
                </span>
              </button>
              <button
                type="button"
                className="mc-session-control-action mc-session-control-action--danger"
                onClick={() => setConfirmation('end')}
              >
                <Power size={16} aria-hidden="true" />
                <span>
                  <strong>End Session</strong>
                  <small>Close the active CLI and remove it from this session list.</small>
                </span>
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function SessionLifecycleNotice({ state }: { state: SessionControlState }) {
  const tone = state.kind === 'error' ? 'error' : state.kind === 'end' ? 'ending' : 'restart';
  const message = state.kind === 'error'
    ? state.message
    : state.kind === 'end'
      ? 'Ending session · flushing the transcript before closing.'
      : state.phase === 'stopping'
        ? 'Restarting session · closing the current CLI cleanly.'
        : state.phase === 'starting'
          ? 'Restarting session · restoring the previous launch profile.'
          : 'Session restarted · terminal connection restored.';
  return (
    <div
      className={`mc-session-lifecycle mc-session-lifecycle--${tone}`}
      role={state.kind === 'error' ? 'alert' : 'status'}
      aria-live="polite"
    >
      {state.kind === 'error'
        ? <AlertTriangle size={14} aria-hidden="true" />
        : state.kind === 'end'
          ? <Power size={14} aria-hidden="true" />
          : <RotateCcw size={14} aria-hidden="true" />}
      <span>{message}</span>
    </div>
  );
}

const SessionListItem = memo(function SessionListItem({
  item,
  attention,
  selected,
  onSelect,
}: {
  item: LaneItem;
  attention?: AttentionItem;
  selected: boolean;
  onSelect: (sessionId: string) => void;
}) {
  const { session } = item;
  const tone = session.status === 'attention'
    ? 'attention'
    : attention?.kind === 'ready-to-review'
      ? 'review'
      : attention
        ? 'warning'
        : session.status;
  const detail = attention?.detail
    || (session.status === 'attention' ? session.statusReason : undefined)
    || item.lastAction
    || STATUS_LABEL[session.status];
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={`mc-session-item mc-session-item--${tone} ${selected ? 'mc-session-item--selected' : ''}`}
      onClick={() => onSelect(session.id)}
      aria-label={`Open ${session.name}, ${attention?.label || STATUS_LABEL[session.status]}`}
    >
      <span className={`mc-live-dot mc-live-dot--${session.status}`} aria-hidden="true" />
      <span className="mc-session-item-copy">
        <span className="mc-session-item-topline">
          <span className="mc-session-item-name" title={session.name} translate="no">
            <CliIcon cliType={session.cliType} />
            {session.name}
          </span>
          <span className="mc-session-item-status">{attention?.label || STATUS_LABEL[session.status]}</span>
        </span>
        <span className="mc-session-item-subline">
          <span className="mc-session-item-detail" title={detail}>{detail}</span>
          <span className="mc-session-item-meta">
            {item.contextUsage === null ? timeAgo(item.lastActivity) : `${numberFormat.format(100 - item.contextUsage)}% left`}
          </span>
        </span>
      </span>
    </button>
  );
});

function SessionSidebar({
  sessions,
  queue,
  selectedSessionId,
  onSelect,
}: {
  sessions: LaneItem[];
  queue: AttentionItem[];
  selectedSessionId: string | null;
  onSelect: (sessionId: string) => void;
}) {
  const attentionBySession = new Map(queue.map(item => [item.sessionId, item]));
  return (
    <aside className="mc-session-sidebar" aria-labelledby="mc-session-list-title">
      <header className="mc-section-header">
        <div>
          <span className="mc-eyebrow">Sessions</span>
          <h2 id="mc-session-list-title">Session List</h2>
        </div>
        <span className={`mc-key-hint ${queue.length > 0 ? 'mc-key-hint--attention' : ''}`}>
          {numberFormat.format(sessions.length)}
          {queue.length > 0 ? ` · ${numberFormat.format(queue.length)} need you` : ''}
        </span>
      </header>

      {sessions.length > 0 ? (
        <div className="mc-session-list">
          {sessions.map(item => (
            <SessionListItem
              key={item.session.id}
              item={item}
              attention={attentionBySession.get(item.session.id)}
              selected={selectedSessionId === item.session.id}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : (
        <div className="mc-session-list-empty">Start a session from New.</div>
      )}
    </aside>
  );
}

function ConsoleWorkspace(props: DashboardV2ViewProps) {
  const {
    model,
    selectedSession,
    selectedAttention,
    selectedContextUsage,
    consoleVisible,
    canvas,
    changes,
    onReviewChanges,
    onRequestSummary,
    onFullscreenSession,
    onInspectSession,
    sessionControlState,
    sessionControlsAvailable,
    onRestartSession,
    onEndSession,
    onContinueSession,
  } = props;

  if (!selectedSession) {
    return (
      <main id="mc-console-workspace" className="mc-console-workspace mc-console-workspace--empty" tabIndex={-1}>
        <Terminal size={29} strokeWidth={1.35} aria-hidden="true" />
        <h2>{model.stats.total === 0 ? 'No Active Sessions' : 'Select a Session'}</h2>
        <p>
          {model.stats.total === 0
            ? 'Start a session from “+ New” to open its CLI here.'
            : 'Choose a session from the session list.'}
        </p>
      </main>
    );
  }

  const hasReview = selectedAttention?.kind === 'ready-to-review'
    || (selectedSession.filesModified?.length ?? 0) > 0;
  const changeCount = changes.data?.files.length ?? selectedSession.filesModified?.length ?? 0;

  return (
    <main id="mc-console-workspace" className="mc-console-workspace" tabIndex={-1}>
      <header className="mc-console-header">
        <div className="mc-console-title-row">
          <div className="mc-console-identity">
            <span className="mc-console-provider">
              <CliIcon cliType={selectedSession.cliType} />
              {selectedSession.cliType === 'copilot' ? 'GitHub Copilot' : 'Claude Code'}
            </span>
            <div className="mc-console-name-row">
              <h2>{selectedSession.name}</h2>
              <span className={`mc-status mc-status--${selectedSession.status}`}>
                {STATUS_LABEL[selectedSession.status]}
              </span>
            </div>
          </div>
          <div className="mc-console-actions">
            <button
              type="button"
              className="mc-icon-button"
              onClick={onInspectSession}
              aria-label="Open session inspector"
              title="Session Inspector"
            >
              <SlidersHorizontal size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="mc-icon-button"
              onClick={canvas.openCanvas}
              aria-label="Open Context Canvas"
              title="Open Context Canvas"
            >
              <PanelRightOpen size={16} aria-hidden="true" />
            </button>
            {hasReview ? (
              <button
                type="button"
                className="mc-button mc-button--secondary"
                onClick={() => onReviewChanges(selectedSession.id)}
                aria-label={changeCount > 0 ? `Review ${numberFormat.format(changeCount)} changed files` : 'Review diff'}
                title={changeCount > 0 ? `Review ${numberFormat.format(changeCount)} Changed Files` : 'Review Diff'}
              >
                <GitCompareArrows size={14} aria-hidden="true" />
                <span>Review {changeCount > 0 ? `${numberFormat.format(changeCount)} Files` : 'Diff'}</span>
              </button>
            ) : null}
            {!selectedSession.summaryBullets?.length ? (
              <button
                type="button"
                className="mc-button mc-button--secondary"
                onClick={() => onRequestSummary(selectedSession.id)}
                aria-label="Request session summary"
                title="Request Summary"
              >
                <ScrollText size={14} aria-hidden="true" />
                <span>Request Summary</span>
              </button>
            ) : null}
            <button
              type="button"
              className="mc-icon-button"
              onClick={() => onFullscreenSession(selectedSession.id)}
              aria-label="Open terminal fullscreen"
              title="Fullscreen Terminal"
            >
              <Maximize2 size={16} aria-hidden="true" />
            </button>
            <SessionPowerControl
              key={selectedSession.id}
              session={selectedSession}
              state={sessionControlState}
              available={sessionControlsAvailable}
              onContinue={onContinueSession}
              onRestart={onRestartSession}
              onEnd={onEndSession}
            />
          </div>
        </div>

        <div className="mc-console-meta">
          <span title={selectedSession.cwd} translate="no"><Terminal size={13} aria-hidden="true" /> {shortPath(selectedSession.cwd)}</span>
          <span><Clock3 size={13} aria-hidden="true" /> {timeAgo(selectedSession.lastActivity || selectedSession.createdAt)}</span>
          <span><Bot size={13} aria-hidden="true" /> {numberFormat.format(selectedSession.agents.length)} {selectedSession.agents.length === 1 ? 'Subagent' : 'Subagents'}</span>
          <MiniContext usage={selectedContextUsage} />
        </div>

        {changes.error && hasReview ? (
          <div className="mc-console-error" role="alert">
            <AlertTriangle size={14} aria-hidden="true" />
            {changes.error}
          </div>
        ) : null}
        {sessionControlState ? <SessionLifecycleNotice state={sessionControlState} /> : null}
      </header>

      <div className={`mc-session-surface ${canvas.isOpen ? 'mc-session-surface--canvas' : ''}`}>
        <section className="mc-console-frame" aria-label={`${selectedSession.name} CLI`}>
          <div className="mc-console-frame-label">
            <span><span className="mc-live-dot mc-live-dot--working" /> Interactive CLI</span>
            <span>Live PTY · Input Enabled</span>
          </div>
          <div className="mc-console-stage">
            {consoleVisible ? (
              <SessionConsole
                sessionId={selectedSession.id}
                sessionName={selectedSession.name}
                cwd={selectedSession.cwd}
                visible
                cliType={selectedSession.cliType}
                onNavigate={canvas.openRequest}
              />
            ) : null}
          </div>
        </section>
        {canvas.isOpen ? (
          <ContextCanvas
            sessionId={selectedSession.id}
            sessionName={selectedSession.name}
            cwd={selectedSession.cwd}
            controller={canvas}
          />
        ) : null}
      </div>
    </main>
  );
}

export default function DashboardV2(props: DashboardV2ViewProps) {
  return (
    <div className="mc-shell" data-scroll-area>
      <a className="mc-skip-link" href="#mc-console-workspace">Skip to CLI</a>
      <div className="mc-frame">
        <DashboardV2Nav {...props.navigation} />
        <div className="mc-workspace">
          <SessionSidebar
            sessions={props.model.fleet}
            queue={props.model.queue}
            selectedSessionId={props.selectedSessionId}
            onSelect={props.onSelectSession}
          />
          <ConsoleWorkspace {...props} />
        </div>
      </div>
    </div>
  );
}
