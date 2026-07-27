'use client';

import {
  AlertTriangle,
  Bot,
  Clock3,
  ExternalLink,
  GitCompareArrows,
  Info,
  Maximize2,
  PanelRightOpen,
  ScrollText,
  Terminal,
} from 'lucide-react';
import { memo } from 'react';
import type { AttentionItem, LaneItem } from '@/lib/dashboard/attentionQueue';
import type { SessionData } from '@/lib/types';
import CliIcon from '../CliIcon';
import ContextCanvas from '../context-canvas/ContextCanvas';
import SessionConsole from '../SessionConsole';
import DashboardV2Nav from './DashboardV2Nav';
import type { DashboardV2ViewProps } from './types';

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
    onOpenSession,
    onReviewChanges,
    onRequestSummary,
    onFullscreenSession,
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
              onClick={() => canvas.openSearch('', false)}
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
            <button type="button" className="mc-icon-button" onClick={() => onOpenSession(selectedSession.id)} aria-label="Open legacy session details" title="Session Details">
              <Info size={16} aria-hidden="true" />
            </button>
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
