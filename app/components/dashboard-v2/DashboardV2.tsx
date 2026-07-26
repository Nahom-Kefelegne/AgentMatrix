'use client';

import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleGauge,
  Clock3,
  ExternalLink,
  GitCompareArrows,
  Info,
  Maximize2,
  MessageSquareText,
  ScrollText,
  ShieldAlert,
  Terminal,
  type LucideIcon,
} from 'lucide-react';
import { memo } from 'react';
import type { AttentionItem, AttentionKind, LaneItem } from '@/lib/dashboard/attentionQueue';
import type { SessionData } from '@/lib/types';
import CliIcon from '../CliIcon';
import SessionConsole from '../SessionConsole';
import DashboardV2Nav from './DashboardV2Nav';
import type { DashboardV2ViewProps } from './types';

const SIGNAL_META: Record<AttentionKind, {
  icon: LucideIcon;
  label: string;
  tone: string;
}> = {
  'approve-command': { icon: ShieldAlert, label: 'Approval Required', tone: 'critical' },
  'needs-decision': { icon: MessageSquareText, label: 'Decision Required', tone: 'critical' },
  'context-critical': { icon: CircleGauge, label: 'Context Critical', tone: 'critical' },
  'ready-to-review': { icon: GitCompareArrows, label: 'Review Ready', tone: 'review' },
  'context-warning': { icon: CircleGauge, label: 'Context Warning', tone: 'warning' },
  'possibly-stuck': { icon: Clock3, label: 'Possibly Stalled', tone: 'warning' },
};

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

function waitingFor(timestamp?: number): string {
  if (!timestamp) return 'unknown';
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${numberFormat.format(Math.max(1, seconds))}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${numberFormat.format(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${numberFormat.format(hours)}h`;
  return `${numberFormat.format(Math.floor(hours / 24))}d`;
}

function shortPath(path?: string): string {
  if (!path) return 'No Working Directory';
  const normalized = path.replaceAll('\\', '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts.slice(-2).join('/') || path;
}

function Sparkline({ values }: { values: number[] }) {
  return (
    <span className="mc-sparkline" aria-hidden="true">
      {values.map((value, index) => (
        <span
          key={index}
          className="mc-sparkline-bar"
          style={{ height: `${Math.max(2, Math.round(value * 18))}px` }}
        />
      ))}
    </span>
  );
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

const SignalRow = memo(function SignalRow({
  item,
  selected,
  onSelect,
}: {
  item: AttentionItem;
  selected: boolean;
  onSelect: (sessionId: string) => void;
}) {
  const meta = SIGNAL_META[item.kind];
  const Icon = meta.icon;
  return (
    <button
      id={`mc-signal-${item.sessionId}`}
      type="button"
      aria-pressed={selected}
      className={`mc-signal mc-signal--${meta.tone} ${selected ? 'mc-signal--selected' : ''}`}
      onClick={() => onSelect(item.sessionId)}
    >
      <span className="mc-signal-node" aria-hidden="true" />
      <span className="mc-signal-icon"><Icon size={15} strokeWidth={1.8} aria-hidden="true" /></span>
      <span className="mc-signal-content">
        <span className="mc-signal-topline">
          <span className="mc-signal-name">{item.sessionName}</span>
          <span className="mc-signal-age">{timeAgo(item.waitingSince)}</span>
        </span>
        <span className="mc-signal-label">{meta.label}</span>
        {item.detail ? <span className="mc-signal-detail">{item.detail}</span> : null}
      </span>
      <ChevronRight className="mc-signal-chevron" size={15} aria-hidden="true" />
    </button>
  );
});

function SignalQueue({
  queue,
  selectedSessionId,
  onSelect,
}: {
  queue: AttentionItem[];
  selectedSessionId: string | null;
  onSelect: (sessionId: string) => void;
}) {
  return (
    <aside className="mc-queue" aria-labelledby="mc-queue-title">
      <header className="mc-section-header">
        <div>
          <span className="mc-eyebrow">Human Queue</span>
          <h2 id="mc-queue-title">What Needs You</h2>
        </div>
        <span className="mc-key-hint">{numberFormat.format(queue.length)} Signals</span>
      </header>

      {queue.length > 0 ? (
        <div className="mc-signal-list" aria-label="Sessions Needing Attention">
          {queue.map(item => (
            <SignalRow
              key={item.id}
              item={item}
              selected={selectedSessionId === item.sessionId}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : (
        <div className="mc-queue-clear">
          <CheckCircle2 size={20} strokeWidth={1.6} aria-hidden="true" />
          <div>
            <strong>Nothing Is Blocked</strong>
            <span>Healthy sessions stay in the quiet rail below.</span>
          </div>
        </div>
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
            : 'Choose an attention signal or a session from the quiet rail.'}
        </p>
      </main>
    );
  }

  const signalMeta = selectedAttention ? SIGNAL_META[selectedAttention.kind] : null;
  const SignalIcon = signalMeta?.icon;
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

        <div className={`mc-console-signal mc-console-signal--${signalMeta?.tone || 'healthy'}`}>
          {SignalIcon
            ? <SignalIcon size={14} strokeWidth={1.8} aria-hidden="true" />
            : <Activity size={14} strokeWidth={1.8} aria-hidden="true" />}
          <strong>{signalMeta?.label || 'No Intervention Requested'}</strong>
          <span>{selectedAttention?.detail || selectedSession.lastToolSummary || 'The CLI is ready.'}</span>
          {selectedAttention ? <em>Waiting {waitingFor(selectedAttention.waitingSince)}</em> : null}
        </div>

        {changes.error && hasReview ? (
          <div className="mc-console-error" role="alert">
            <AlertTriangle size={14} aria-hidden="true" />
            {changes.error}
          </div>
        ) : null}
      </header>

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
            />
          ) : null}
        </div>
      </section>
    </main>
  );
}

const TelemetryItem = memo(function TelemetryItem({
  item,
  selected,
  onSelect,
}: {
  item: LaneItem;
  selected: boolean;
  onSelect: (sessionId: string) => void;
}) {
  const { session } = item;
  return (
    <button
      type="button"
      className={`mc-telemetry-item ${selected ? 'mc-telemetry-item--selected' : ''}`}
      onClick={() => onSelect(session.id)}
      aria-label={`Open ${session.name} CLI`}
    >
      <span className={`mc-live-dot mc-live-dot--${session.status}`} />
      <span className="mc-telemetry-name">{session.name}</span>
      <span className="mc-telemetry-action">{item.lastAction || STATUS_LABEL[session.status]}</span>
      <Sparkline values={item.sparkline} />
      <span className="mc-telemetry-context">
        {item.contextUsage === null ? 'ctx —' : `ctx ${numberFormat.format(item.contextUsage)}%`}
      </span>
    </button>
  );
});

function TelemetryRail({
  working,
  idle,
  selectedSessionId,
  onSelect,
}: {
  working: LaneItem[];
  idle: LaneItem[];
  selectedSessionId: string | null;
  onSelect: (sessionId: string) => void;
}) {
  const items = [...working, ...idle];
  return (
    <section className="mc-telemetry" aria-labelledby="mc-telemetry-title">
      <div className="mc-telemetry-heading">
        <div>
          <span className="mc-eyebrow">Quiet Rail</span>
          <h2 id="mc-telemetry-title">Running Without You</h2>
        </div>
        <span>{numberFormat.format(working.length)} Active · {numberFormat.format(idle.length)} Quiet</span>
      </div>
      {items.length > 0 ? (
        <div className="mc-telemetry-track">
          {items.map(item => (
            <TelemetryItem
              key={item.session.id}
              item={item}
              selected={selectedSessionId === item.session.id}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : (
        <div className="mc-telemetry-empty">Sessions needing attention are shown above.</div>
      )}
    </section>
  );
}

export default function DashboardV2(props: DashboardV2ViewProps) {
  return (
    <div className="mc-shell" data-scroll-area>
      <a className="mc-skip-link" href="#mc-console-workspace">Skip to CLI</a>
      <div className="mc-frame">
        <DashboardV2Nav {...props.navigation} />
        <div className="mc-workspace">
          <SignalQueue
            queue={props.model.queue}
            selectedSessionId={props.selectedSessionId}
            onSelect={props.onSelectSession}
          />
          <ConsoleWorkspace {...props} />
        </div>
        <TelemetryRail
          working={props.model.working}
          idle={props.model.idle}
          selectedSessionId={props.selectedSessionId}
          onSelect={props.onSelectSession}
        />
      </div>
    </div>
  );
}
