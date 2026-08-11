'use client';

import {
  Blocks,
  Bot,
  Check,
  ClipboardList,
  Clock3,
  Copy,
  Cpu,
  Folder,
  Gauge,
  KeyRound,
  Save,
  Server,
  Shield,
  SlidersHorizontal,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { SessionInspectorData } from '@/lib/session-inspector/types';
import type { SessionData } from '@/lib/types';
import CliIcon from '../CliIcon';
import { Modal } from '../ui/Modal';
import { useSocketContext } from '../SocketProvider';

type InspectorTab = 'overview' | 'mcps' | 'tasks';
type RenameState = 'idle' | 'saving' | 'saved' | 'error';

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function displayValue(value: string | undefined): string {
  return value?.trim() || 'Provider default';
}

function ManifestRow({
  icon,
  label,
  value,
  mono = false,
  action,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  mono?: boolean;
  action?: ReactNode;
}) {
  return (
    <div className="si-manifest-row">
      <span className="si-manifest-icon" aria-hidden="true">{icon}</span>
      <span className="si-manifest-copy">
        <span>{label}</span>
        <strong className={mono ? 'si-mono' : ''} title={value}>{value}</strong>
      </span>
      {action}
    </div>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="si-copy"
      aria-label={`Copy ${label}`}
      title={`Copy ${label}`}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1_600);
        });
      }}
    >
      {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
    </button>
  );
}

function EmptyState({
  icon,
  title,
  detail,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <div className="si-empty">
      {icon}
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

interface SessionInspectorProps {
  isOpen: boolean;
  onClose: () => void;
  session: SessionData;
  contextUsage: number | null;
  onOpenTaskBoard: () => void;
}

export default function SessionInspector({
  isOpen,
  onClose,
  session,
  contextUsage,
  onOpenTaskBoard,
}: SessionInspectorProps) {
  const { socketRef } = useSocketContext();
  const [tab, setTab] = useState<InspectorTab>('overview');
  const [data, setData] = useState<SessionInspectorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState(session.name);
  const [renameState, setRenameState] = useState<RenameState>('idle');
  const [renameError, setRenameError] = useState<string | null>(null);

  useEffect(() => {
    setTab('overview');
    setRenameValue(session.name);
    setRenameState('idle');
    setRenameError(null);
  }, [session.id, session.name]);

  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    fetch(`/api/sessions/inspector?sessionId=${encodeURIComponent(session.id)}`, {
      signal: controller.signal,
    })
      .then(async response => {
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(payload?.error || `Session inspector failed (${response.status}).`);
        }
        setData(payload as SessionInspectorData);
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        setLoadError(error instanceof Error ? error.message : 'Unable to load session details.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [isOpen, session.id]);

  const rename = async () => {
    const nextName = renameValue.trim();
    if (!nextName || nextName === session.name || renameState === 'saving') return;
    setRenameState('saving');
    setRenameError(null);
    try {
      const response = await fetch('/api/sessions/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: session.id,
          name: nextName,
          cliType: session.cliType,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || `Rename failed (${response.status}).`);
      }
      if ((session.cliType ?? 'claude') === 'claude') {
        socketRef.current?.emit('terminal:input', {
          sessionId: session.id,
          data: `/rename ${nextName}\r`,
        });
      }
      setRenameState('saved');
      window.setTimeout(() => setRenameState('idle'), 1_800);
    } catch (error) {
      setRenameState('error');
      setRenameError(error instanceof Error ? error.message : 'Rename failed.');
    }
  };

  const contextLeft = contextUsage === null
    ? 'Unknown'
    : `${Math.max(0, 100 - contextUsage)}%`;
  const mcpCount = data?.mcps.length ?? 0;
  const taskCount = data?.tasks.length ?? 0;
  const statusLabel = session.status === 'attention'
    ? 'Needs you'
    : session.status === 'meeting'
      ? 'In meeting'
      : session.status[0].toUpperCase() + session.status.slice(1);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={session.name}
      eyebrow="Session inspector"
      description={`${session.cliType === 'copilot' ? 'GitHub Copilot' : 'Claude Code'} · ${session.cwd || 'No working directory'}`}
      icon={<SlidersHorizontal size={17} />}
      variant="drawer"
      width={760}
      className="si-drawer"
      bodyClassName="si-modal-body"
      headerActions={(
        <span className={`si-status si-status--${session.status}`}>
          <span aria-hidden="true" />
          {statusLabel}
        </span>
      )}
    >
      <div className="si-layout">
        <nav className="si-rail" aria-label="Session inspector sections">
          {([
            ['overview', 'Overview', null, SlidersHorizontal],
            ['mcps', 'MCPs', mcpCount, Blocks],
            ['tasks', 'Tasks', taskCount, ClipboardList],
          ] as const).map(([id, label, count, Icon]) => (
            <button
              key={id}
              type="button"
              className={tab === id ? 'si-rail-item si-rail-item--active' : 'si-rail-item'}
              aria-current={tab === id ? 'page' : undefined}
              onClick={() => setTab(id)}
            >
              <Icon size={14} aria-hidden="true" />
              <span>{label}</span>
              {count !== null ? <strong>{count}</strong> : null}
            </button>
          ))}
          <div className="si-rail-identity">
            <CliIcon cliType={session.cliType} />
            <code>{session.id.slice(0, 8)}</code>
          </div>
        </nav>

        <div className="si-content">
          {loading ? (
            <div className="si-loading" role="status">
              <span />
              Reading session manifest…
            </div>
          ) : loadError ? (
            <div className="si-error" role="alert">{loadError}</div>
          ) : null}

          {tab === 'overview' ? (
            <>
              <section className="si-section">
                <div className="si-section-heading">
                  <span>Identity</span>
                  <strong>Name this session by its job</strong>
                </div>
                <div className="si-rename">
                  <input
                    data-autofocus
                    value={renameValue}
                    maxLength={100}
                    aria-label="Session name"
                    onChange={event => {
                      setRenameValue(event.target.value);
                      setRenameState('idle');
                      setRenameError(null);
                    }}
                    onKeyDown={event => {
                      if (event.key === 'Enter') void rename();
                    }}
                  />
                  <button
                    type="button"
                    disabled={
                      renameState === 'saving'
                      || !renameValue.trim()
                      || renameValue.trim() === session.name
                    }
                    onClick={() => void rename()}
                  >
                    {renameState === 'saved' ? <Check size={13} aria-hidden="true" /> : <Save size={13} aria-hidden="true" />}
                    {renameState === 'saving' ? 'Saving…' : renameState === 'saved' ? 'Saved' : 'Save name'}
                  </button>
                </div>
                {renameError ? <div className="si-inline-error" role="alert">{renameError}</div> : null}
              </section>

              <section className="si-section">
                <div className="si-metrics" aria-label="Session summary">
                  <div><span>Status</span><strong>{statusLabel}</strong></div>
                  <div><span>Context left</span><strong>{contextLeft}</strong></div>
                  <div><span>Subagents</span><strong>{session.agents.length}</strong></div>
                  <div><span>Files changed</span><strong>{session.filesModified?.length ?? 0}</strong></div>
                </div>
              </section>

              <section className="si-section">
                <div className="si-section-heading">
                  <span>Session manifest</span>
                  <strong>Runtime identity and location</strong>
                </div>
                <div className="si-manifest">
                  <ManifestRow
                    icon={<Folder size={14} />}
                    label="Working directory"
                    value={session.cwd || 'Unavailable'}
                    mono
                    action={session.cwd ? <CopyButton value={session.cwd} label="working directory" /> : undefined}
                  />
                  <ManifestRow
                    icon={<KeyRound size={14} />}
                    label="Session ID"
                    value={session.id}
                    mono
                    action={<CopyButton value={session.id} label="session ID" />}
                  />
                  <ManifestRow
                    icon={<Clock3 size={14} />}
                    label="Created"
                    value={dateTimeFormat.format(session.createdAt)}
                  />
                  <ManifestRow
                    icon={<Gauge size={14} />}
                    label="Last activity"
                    value={session.lastActivity ? dateTimeFormat.format(session.lastActivity) : 'No activity recorded'}
                  />
                </div>
              </section>

              <section className="si-section">
                <div className="si-section-heading">
                  <span>Launch profile</span>
                  <strong>Configuration restored on restart</strong>
                </div>
                <div className="si-profile-grid">
                  <div><Cpu size={14} /><span>Model</span><strong>{displayValue(data?.profile.model)}</strong></div>
                  <div><Shield size={14} /><span>Permissions</span><strong>{displayValue(data?.profile.permissionMode)}</strong></div>
                  <div><Bot size={14} /><span>Effort</span><strong>{displayValue(data?.profile.effort)}</strong></div>
                  <div><Server size={14} /><span>Mode</span><strong>{displayValue(data?.profile.copilotMode)}</strong></div>
                </div>
                {data?.profile.allowedTools ? (
                  <div className="si-allowed-tools">
                    <span>Allowed tools</span>
                    <code>{data.profile.allowedTools}</code>
                  </div>
                ) : null}
              </section>
            </>
          ) : null}

          {tab === 'mcps' ? (
            <section className="si-section">
              <div className="si-section-heading">
                <span>Known MCPs</span>
                <strong>{mcpCount} configured for this session</strong>
                <p>Static and runtime-injected configuration is reconciled without environment values. Connection health is not yet reported.</p>
              </div>
              {data?.mcps.length ? (
                <div className="si-mcp-list">
                  {data.mcps.map(mcp => (
                    <article key={mcp.id} className="si-mcp-row">
                      <span className={mcp.managed ? 'si-mcp-node si-mcp-node--managed' : 'si-mcp-node'} aria-hidden="true" />
                      <div className="si-mcp-copy">
                        <div>
                          <strong>{mcp.name}</strong>
                          <span className={`si-scope si-scope--${mcp.scope}`}>{mcp.scope}</span>
                        </div>
                        <span>{mcp.transport.toUpperCase()}{mcp.command ? ` · ${mcp.command}` : ''} · {mcp.effectiveSource}</span>
                        {mcp.sources.length > 1 ? (
                          <small>{mcp.sources.length} configuration sources reconciled</small>
                        ) : null}
                        {mcp.envKeys.length > 0 ? (
                          <code>{mcp.envKeys.join(' · ')}</code>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={<Blocks size={23} aria-hidden="true" />}
                  title="No configured MCP servers found"
                  detail="Provider built-ins and Agency-injected runtime servers are not yet discoverable here."
                />
              )}
            </section>
          ) : null}

          {tab === 'tasks' ? (
            <section className="si-section">
              <div className="si-section-heading si-section-heading--actions">
                <div>
                  <span>Assigned work</span>
                  <strong>{taskCount} task{taskCount === 1 ? '' : 's'} assigned</strong>
                </div>
                <button type="button" className="si-secondary-action" onClick={onOpenTaskBoard}>
                  Open Task Board
                </button>
              </div>
              {data?.tasks.length ? (
                <div className="si-task-list">
                  {data.tasks.map(task => (
                    <button
                      key={task.id}
                      type="button"
                      className="si-task-row"
                      onClick={onOpenTaskBoard}
                    >
                      <span className="si-task-spine" aria-hidden="true" />
                      <span className="si-task-copy">
                        <span>
                          <strong>{task.subject}</strong>
                          <em className={`si-task-state si-task-state--${task.status}`}>{task.status}</em>
                        </span>
                        {task.description ? <small>{task.description}</small> : null}
                        <code>
                          {task.type || 'Task'}
                          {task.adoId ? ` · ADO #${task.adoId}` : ''}
                          {task.priority ? ` · ${task.priority}` : ''}
                        </code>
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={<ClipboardList size={23} aria-hidden="true" />}
                  title="No tasks assigned"
                  detail="Assign work from the Task Board and it will appear here."
                />
              )}
            </section>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
