'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  Clipboard,
  FolderClock,
  RotateCcw,
  Search,
  Square,
} from 'lucide-react';
import { buildResumeShellCommand } from '@/lib/cli/uiMetadata';
import type { CliType, ResumeSessionRequest } from '@/lib/types';
import { useOrchestrator } from '@/lib/hooks/useOrchestrator';
import CliIcon from './CliIcon';
import { FolderPicker } from './ui/FolderPicker';
import { Modal, OptionButton, OptionGroup, TextInput } from './ui/Modal';

interface SessionInfo {
  id: string;
  name: string;
  cwd?: string;
  slug: string;
  projectDir?: string;
  lastModified: number;
  active: boolean;
  cliType?: CliType;
}

interface ResumeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onResumeInApp?: (session: ResumeSessionRequest) => void;
}

type SearchMode = 'project' | 'all' | 'deep';

const relativeTime = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'narrow' });

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return relativeTime.format(0, 'second');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return relativeTime.format(-minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return relativeTime.format(-hours, 'hour');
  return relativeTime.format(-Math.floor(hours / 24), 'day');
}

function SessionRow({
  session,
  showPath,
  onResume,
}: {
  session: SessionInfo;
  showPath: boolean;
  onResume?: (session: ResumeSessionRequest) => void;
}) {
  const [copied, setCopied] = useState(false);
  const copyCommand = () => {
    navigator.clipboard.writeText(
      buildResumeShellCommand({ cliType: session.cliType || 'claude', resumeId: session.id }),
    );
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2_000);
  };

  return (
    <article className="cc-resume-session">
      <div className="cc-resume-session-provider">
        <CliIcon cliType={session.cliType} />
        <span>{session.cliType === 'copilot' ? 'GitHub Copilot' : 'Claude Code'}</span>
        <time>{formatTimeAgo(session.lastModified)}</time>
      </div>
      <div className="cc-resume-session-main">
        <div className="cc-resume-session-copy">
          <strong>{session.name}</strong>
          {showPath && session.cwd ? <span title={session.cwd}>{session.cwd}</span> : null}
          <code>{session.id}</code>
        </div>
        <div className="cc-resume-session-actions">
          {onResume ? (
            <button
              type="button"
              className="btn-primary"
              onClick={() => onResume({
                sessionId: session.id,
                name: session.name,
                cwd: session.cwd,
                cliType: session.cliType,
              })}
            >
              <RotateCcw size={13} aria-hidden="true" />
              Resume
            </button>
          ) : null}
          <button type="button" className="btn-outline" onClick={copyCommand}>
            {copied ? <Check size={13} aria-hidden="true" /> : <Clipboard size={13} aria-hidden="true" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
    </article>
  );
}

export default function ResumeModal({ isOpen, onClose, onResumeInApp }: ResumeModalProps) {
  const [cwd, setCwd] = useState('');
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<SearchMode>('all');
  const [cliFilter, setCliFilter] = useState<'all' | CliType>('all');
  const [directId, setDirectId] = useState('');
  const [directIdError, setDirectIdError] = useState('');
  const [resolving, setResolving] = useState(false);
  const { query: queryOrchestrator } = useOrchestrator();
  const [deepQuery, setDeepQuery] = useState('');
  const [deepSearching, setDeepSearching] = useState(false);
  const [deepResults, setDeepResults] = useState<SessionInfo[]>([]);
  const [deepError, setDeepError] = useState('');
  const abortRef = useRef(false);

  useEffect(() => {
    if (!isOpen || cwd) return;
    fetch('/api/system')
      .then(response => response.json())
      .then(data => setCwd(data.homedir || ''))
      .catch(() => {});
  }, [cwd, isOpen]);

  const loadSessions = useCallback(async (path: string, global: boolean) => {
    setLoading(true);
    setLoadError('');
    try {
      const url = global ? '/api/sessions/list?global=true' : `/api/sessions/list?cwd=${encodeURIComponent(path)}`;
      const response = await fetch(url);
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Session discovery failed.');
      setSessions(data.sessions || []);
    } catch (error) {
      setSessions([]);
      setLoadError(error instanceof Error ? error.message : 'Session discovery failed.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen && mode !== 'deep') void loadSessions(cwd, mode === 'all');
  }, [cwd, isOpen, loadSessions, mode]);

  const resolveSession = async (id: string): Promise<ResumeSessionRequest | null> => {
    try {
      const response = await fetch(`/api/sessions/resolve?id=${encodeURIComponent(id)}`);
      if (!response.ok) return null;
      const data = await response.json();
      if (!data.cwd) return null;
      return {
        sessionId: id,
        name: typeof data.name === 'string' ? data.name : undefined,
        cwd: data.cwd,
        cliType: data.cliType === 'copilot' || data.cliType === 'claude' ? data.cliType : undefined,
      };
    } catch {
      return null;
    }
  };

  const resumeSession = useCallback((session: ResumeSessionRequest) => {
    onResumeInApp?.(session);
    onClose();
  }, [onClose, onResumeInApp]);

  const handleDirectResume = async () => {
    const id = directId.trim();
    if (!id) {
      setDirectIdError('Enter a session ID.');
      return;
    }
    if (!/^[0-9a-f-]{8,}$/i.test(id)) {
      setDirectIdError('Use a valid session UUID.');
      return;
    }
    setDirectIdError('');
    setResolving(true);
    const session = await resolveSession(id);
    setResolving(false);
    if (!session) {
      setDirectIdError('AgentMatrix could not find that session.');
      return;
    }
    if (onResumeInApp) {
      resumeSession(session);
      return;
    }
    navigator.clipboard.writeText(
      `cd ${session.cwd} && ${buildResumeShellCommand({ cliType: session.cliType || 'claude', resumeId: id })}`,
    );
  };

  const handleDeepSearch = useCallback(async () => {
    const query = deepQuery.trim();
    if (!query) return;
    setDeepSearching(true);
    setDeepResults([]);
    setDeepError('');
    abortRef.current = false;
    const instruction = [
      'Execute immediately, no preamble, no questions.',
      `Find coding sessions whose transcripts mention: "${query}".`,
      `Run: grep -rli "${query.replace(/"/g, '')}" ~/.claude/projects/*/*.jsonl ~/.copilot/session-state/*/events.jsonl 2>/dev/null`,
      'For each matching path, extract the session UUID: Claude uses the filename without .jsonl; Copilot uses the parent directory name.',
      'Output ONLY UUIDs, one per line, max 10. If there are no matches, output exactly NO_MATCHES.',
    ].join(' ');
    const result = await queryOrchestrator(instruction, 120_000);
    if (abortRef.current) return;
    setDeepSearching(false);
    if (!result.success || /NO_MATCHES/i.test(result.content)) {
      setDeepError('No matching sessions found.');
      return;
    }
    const ids = [
      ...new Set(
        (result.content.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) || [])
          .map(id => id.toLowerCase()),
      ),
    ].slice(0, 10);
    if (ids.length === 0) {
      setDeepError('No matching sessions found.');
      return;
    }
    const resolved: Array<SessionInfo | null> = await Promise.all(ids.map(async (id): Promise<SessionInfo | null> => {
      try {
        const response = await fetch(`/api/sessions/resolve?id=${encodeURIComponent(id)}`);
        if (!response.ok) return null;
        const data = await response.json();
        return {
          id,
          name: data.name || `Session-${id.slice(0, 8)}`,
          cwd: data.cwd,
          slug: '',
          projectDir: data.projectDir,
          lastModified: Date.now(),
          active: false,
          cliType: data.cliType === 'copilot' || data.cliType === 'claude' ? data.cliType : undefined,
        };
      } catch {
        return null;
      }
    }));
    setDeepResults(resolved.filter((session): session is SessionInfo => Boolean(session)));
  }, [deepQuery, queryOrchestrator]);

  const filtered = sessions.filter(session => (
    !session.active
    && (cliFilter === 'all' || (session.cliType || 'claude') === cliFilter)
    && (
      !search
      || session.name.toLowerCase().includes(search.toLowerCase())
      || session.slug?.toLowerCase().includes(search.toLowerCase())
      || session.id.toLowerCase().includes(search.toLowerCase())
    )
  ));

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Resume a Session"
      eyebrow="Session History"
      description="Return a saved provider conversation to the embedded Control Center terminal."
      icon={<FolderClock size={16} />}
      maxWidth={760}
      bodyClassName="cc-resume-body"
    >
      <section className="cc-resume-direct">
        <div>
          <span className="cc-modal-eyebrow">Known session ID</span>
          <strong>Resume directly</strong>
          <p>Use this when you already have a Copilot or Claude session UUID.</p>
        </div>
        <div className="cc-resume-direct-form">
          <TextInput
            data-autofocus
            name="resume-session-id"
            aria-label="Session ID"
            autoComplete="off"
            spellCheck={false}
            value={directId}
            onChange={value => {
              setDirectId(value);
              setDirectIdError('');
            }}
            onKeyDown={event => {
              if (event.key === 'Enter') void handleDirectResume();
            }}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            mono
            error={Boolean(directIdError)}
          />
          <button className="btn-primary" onClick={() => void handleDirectResume()} disabled={resolving}>
            <RotateCcw size={13} aria-hidden="true" />
            {resolving ? 'Resolving…' : 'Resume'}
          </button>
        </div>
        {directIdError ? <div className="error-text">{directIdError}</div> : null}
      </section>

      <div className="cc-resume-toolbar">
        <OptionGroup>
          {([
            ['all', 'All Sessions'],
            ['project', 'By Project'],
            ['deep', 'Transcript Search'],
          ] as [SearchMode, string][]).map(([key, label]) => (
            <OptionButton key={key} selected={mode === key} onClick={() => setMode(key)}>
              {label}
            </OptionButton>
          ))}
        </OptionGroup>
        {mode === 'project' ? <FolderPicker value={cwd} onChange={setCwd} /> : null}
      </div>

      {mode === 'deep' ? (
        <section className="cc-resume-search">
          <div className="cc-resume-search-form">
            <TextInput
              value={deepQuery}
              name="transcript-search"
              aria-label="Transcript search"
              autoComplete="off"
              onChange={setDeepQuery}
              onKeyDown={event => {
                if (event.key === 'Enter' && !deepSearching) void handleDeepSearch();
              }}
              placeholder="Describe the work you remember…"
            />
            {deepSearching ? (
              <button
                type="button"
                className="btn-destructive"
                onClick={() => {
                  abortRef.current = true;
                  setDeepSearching(false);
                }}
              >
                <Square size={12} aria-hidden="true" />
                Stop
              </button>
            ) : (
              <button className="btn-primary" onClick={() => void handleDeepSearch()} disabled={!deepQuery.trim()}>
                <Search size={13} aria-hidden="true" />
                Search
              </button>
            )}
          </div>
          {deepSearching ? (
            <div className="cc-modal-empty" role="status">Searching Claude and Copilot transcripts…</div>
          ) : deepError ? (
            <div className="cc-modal-empty">{deepError}</div>
          ) : deepResults.length > 0 ? (
            <div className="cc-resume-results">
              {deepResults.map(session => (
                <SessionRow key={session.id} session={session} showPath onResume={resumeSession} />
              ))}
            </div>
          ) : (
            <div className="cc-modal-empty">
              Search by a feature, error, file, or decision from a previous conversation.
            </div>
          )}
        </section>
      ) : (
        <section className="cc-resume-search">
          <div className="cc-resume-filter-row">
            <label className="cc-resume-search-input">
              <Search size={14} aria-hidden="true" />
              <input
                type="search"
                name="session-search"
                aria-label="Search saved sessions"
                autoComplete="off"
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Search name or session ID…"
              />
            </label>
            <div className="cc-resume-cli-filter" aria-label="Filter by CLI">
              {(['all', 'copilot', 'claude'] as const).map(filter => (
                <button
                  key={filter}
                  type="button"
                  aria-pressed={cliFilter === filter}
                  onClick={() => setCliFilter(filter)}
                >
                  {filter === 'all' ? 'All' : filter === 'copilot' ? 'Copilot' : 'Claude'}
                </button>
              ))}
            </div>
          </div>
          {loading ? (
            <div className="cc-modal-empty" role="status">Discovering saved sessions…</div>
          ) : loadError ? (
            <div className="cc-modal-empty cc-modal-empty--error">{loadError}</div>
          ) : filtered.length === 0 ? (
            <div className="cc-modal-empty">
              {sessions.length === 0 ? 'No saved sessions were found.' : 'No sessions match this filter.'}
            </div>
          ) : (
            <div className="cc-resume-results">
              {filtered.map(session => (
                <SessionRow
                  key={session.id}
                  session={session}
                  showPath={mode === 'all'}
                  onResume={resumeSession}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </Modal>
  );
}
