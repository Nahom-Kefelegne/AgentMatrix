'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useOrchestrator } from '@/lib/hooks/useOrchestrator';
import { Modal, OptionGroup, OptionButton, TextInput } from './ui/Modal';
import { useThemeContext } from './ThemeProvider';
import { FolderPicker } from './ui/FolderPicker';
import { buildResumeShellCommand } from '@/lib/cli/uiMetadata';
import type { CliType } from '@/lib/types';
import CliIcon from './CliIcon';

interface SessionInfo {
  id: string;
  name: string;
  slug: string;
  projectDir?: string;
  lastModified: number;
  active: boolean;
  cliType?: CliType;
}

interface ResumeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onResumeInApp?: (sessionId: string) => void;
}

type SearchMode = 'project' | 'all' | 'deep';

function formatTimeAgo(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function SessionRow({ s, globalSearch, onResumeInApp, onClose }: {
  s: SessionInfo; globalSearch: boolean; onResumeInApp?: (id: string) => void; onClose: () => void;
}) {
  const { theme } = useThemeContext();
  const dark = theme === 'dark';
  const [copied, setCopied] = useState(false);
  return (
    <div style={{
      background: dark ? '#111' : '#fafafa', border: `1px solid ${dark ? '#1c1c1e' : '#e5e5e5'}`,
      borderRadius: 12, padding: 16, marginBottom: 10,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <CliIcon cliType={s.cliType} />
          <span style={{ fontSize: 16, fontWeight: 700, color: dark ? '#fafafa' : '#0a0a0a' }}>{s.name}</span>
        </div>
        <span style={{ fontSize: 12, color: dark ? '#52525b' : '#a1a1aa' }}>{formatTimeAgo(s.lastModified)}</span>
      </div>
      {s.projectDir && globalSearch && (
        <div style={{ fontSize: 12, color: dark ? '#52525b' : '#a1a1aa', marginBottom: 6, fontFamily: 'monospace' }}>
          {s.projectDir.replace(/^-/, '/').replace(/-/g, '/')}
        </div>
      )}
      <div style={{ fontSize: 12, color: dark ? '#3f3f46' : '#d4d4d8', marginBottom: 12, fontFamily: 'monospace' }}>{s.id.slice(0, 12)}...</div>
      <div style={{ display: 'flex', gap: 8 }}>
        {onResumeInApp && (
          <button className="btn-primary" onClick={() => { onResumeInApp(s.id); onClose(); }}>Resume in App</button>
        )}
        <button className="btn-outline" onClick={() => {
          navigator.clipboard.writeText(
            buildResumeShellCommand({ cliType: s.cliType || 'claude', resumeId: s.id }),
          );
          setCopied(true);
          setTimeout(() => setCopied(false), 3000);
        }}>
          {copied ? '✓ Copied!' : 'Copy Command'}
        </button>
      </div>
    </div>
  );
}

export default function ResumeModal({ isOpen, onClose, onResumeInApp }: ResumeModalProps) {
  const [cwd, setCwd] = useState('');
  useEffect(() => {
    if (!cwd) fetch('/api/system').then(r => r.json()).then(d => setCwd(d.homedir || '')).catch(() => {});
  }, []);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<SearchMode>('all');
  const [cliFilter, setCliFilter] = useState<'all' | CliType>('all');
  const [directId, setDirectId] = useState('');
  const [directIdError, setDirectIdError] = useState('');
  const [resolving, setResolving] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const { query: queryOrchestrator } = useOrchestrator();
  const [deepQuery, setDeepQuery] = useState('');
  const [deepSearching, setDeepSearching] = useState(false);
  const [deepResults, setDeepResults] = useState<SessionInfo[]>([]);
  const [deepError, setDeepError] = useState('');
  const abortRef = useRef(false);

  const loadSessions = useCallback(async (path: string, isGlobal: boolean) => {
    setLoading(true);
    try {
      const url = isGlobal ? '/api/sessions/list?global=true' : `/api/sessions/list?cwd=${encodeURIComponent(path)}`;
      const res = await fetch(url);
      const data = await res.json();
      setSessions(data.sessions || []);
    } catch { setSessions([]); }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (isOpen && mode !== 'deep') loadSessions(cwd, mode === 'all');
  }, [isOpen, cwd, mode, loadSessions]);

  const handleCwdChange = (path: string) => { setCwd(path); if (mode === 'project') loadSessions(path, false); };

  const resolveSessionCwd = async (id: string): Promise<string | null> => {
    try {
      const res = await fetch(`/api/sessions/resolve?id=${encodeURIComponent(id)}`);
      if (!res.ok) return null;
      const data = await res.json();
      return data.cwd || null;
    } catch { return null; }
  };

  const handleDirectResume = async () => {
    const id = directId.trim();
    if (!id) { setDirectIdError('Enter a session ID'); return; }
    if (!/^[0-9a-f-]{8,}$/i.test(id)) { setDirectIdError('Invalid session ID format'); return; }
    setDirectIdError('');
    setResolving(true);
    const sessionCwd = await resolveSessionCwd(id);
    setResolving(false);
    if (!sessionCwd) { setDirectIdError('Session not found'); return; }
    if (onResumeInApp) { onResumeInApp(id); onClose(); }
    else {
      // resolveSessionCwd via /api/sessions/resolve returns cliType too;
      // fetch it again here so the copy reflects the right CLI.
      let cliType: CliType = 'claude';
      try {
        const res = await fetch(`/api/sessions/resolve?id=${encodeURIComponent(id)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.cliType === 'copilot' || data.cliType === 'claude') cliType = data.cliType;
        }
      } catch { /* default to claude */ }
      navigator.clipboard.writeText(
        `cd ${sessionCwd} && ${buildResumeShellCommand({ cliType, resumeId: id })}`,
      );
      setCopied(id);
      setTimeout(() => setCopied(null), 3000);
    }
  };

  const handleDeepSearch = useCallback(async () => {
    if (!deepQuery.trim()) return;
    setDeepSearching(true);
    setDeepResults([]);
    setDeepError('');
    abortRef.current = false;
    const instruction = [
      `Execute immediately, no preamble, no questions.`,
      `Find coding sessions whose transcripts mention: "${deepQuery.trim()}".`,
      `Run: grep -rli "${deepQuery.trim().replace(/"/g, '')}" ~/.claude/projects/*/*.jsonl ~/.copilot/session-state/*/events.jsonl 2>/dev/null`,
      `For each matching path, extract the session UUID: for a Claude path it is the filename without .jsonl; for a Copilot path it is the parent directory name.`,
      `Output ONLY the UUIDs, one per line, max 10. If there are no matches, output exactly NO_MATCHES.`,
    ].join(' ');
    const result = await queryOrchestrator(instruction, 120000);
    if (abortRef.current) return;
    setDeepSearching(false);
    if (!result.success || /NO_MATCHES/i.test(result.content)) {
      setDeepError('No matching sessions found');
      return;
    }
    // Extract UUIDs from anywhere in the output — the agent may wrap them in
    // file paths or prose, so match rather than require whole-line UUIDs.
    const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
    const ids = [...new Set((result.content.match(uuidRe) || []).map(s => s.toLowerCase()))].slice(0, 10);
    if (ids.length === 0) { setDeepError('No matching sessions found'); return; }
    const resolved = await Promise.all(ids.map(async (id) => {
      try {
        const res = await fetch(`/api/sessions/resolve?id=${encodeURIComponent(id)}`);
        if (!res.ok) return null;
        const data = await res.json();
        return { id, name: data.name || `Session-${id.slice(0, 8)}`, slug: '', projectDir: data.projectDir, lastModified: Date.now(), active: false } as SessionInfo;
      } catch { return null; }
    }));
    setDeepResults(resolved.filter(Boolean) as SessionInfo[]);
  }, [deepQuery, queryOrchestrator]);

  const filtered = sessions.filter(s => !s.active &&
    (cliFilter === 'all' || (s.cliType || 'claude') === cliFilter) &&
    (!search || s.name.toLowerCase().includes(search.toLowerCase()) ||
     s.slug?.toLowerCase().includes(search.toLowerCase()) ||
     s.id.toLowerCase().includes(search.toLowerCase()))
  );

  const cliFilterButtons: { key: 'all' | CliType; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'claude', label: 'Claude' },
    { key: 'copilot', label: 'Copilot' },
  ];

  const modeButtons: { key: SearchMode; label: string }[] = [
    { key: 'project', label: 'By Project' },
    { key: 'all', label: 'All Sessions' },
    { key: 'deep', label: 'Deep Search' },
  ];

  const { theme } = useThemeContext();
  const dark = theme === 'dark';
  const muted = dark ? '#71717a' : '#a1a1aa';
  const subtle = dark ? '#3f3f46' : '#d4d4d8';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Resume Session" maxWidth={650}>
      {/* Resume by ID */}
      <div style={{ paddingBottom: 16, marginBottom: 16, borderBottom: `1px solid ${dark ? '#1c1c1e' : '#f0f0f0'}` }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
          Resume by Session ID
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <TextInput value={directId} onChange={v => { setDirectId(v); setDirectIdError(''); }}
            onKeyDown={(e: any) => { if (e.key === 'Enter') handleDirectResume(); }}
            placeholder="Paste session UUID..." mono error={!!directIdError} />
          {onResumeInApp && (
            <button className="btn-primary" onClick={handleDirectResume} disabled={resolving}>
              {resolving ? 'Resolving...' : 'Resume'}
            </button>
          )}
        </div>
        {directIdError && <div style={{ fontSize: 12, color: '#f87171', marginTop: 6 }}>{directIdError}</div>}
      </div>

      {/* Mode toggle */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: mode === 'project' ? 10 : 0 }}>
          {modeButtons.map(m => (
            <OptionButton key={m.key} selected={mode === m.key} onClick={() => setMode(m.key)}>{m.label}</OptionButton>
          ))}
        </div>
        {mode === 'project' && <div style={{ marginTop: 10 }}><FolderPicker value={cwd} onChange={handleCwdChange} /></div>}
      </div>

      {/* Content */}
      {mode === 'deep' ? (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <TextInput value={deepQuery} onChange={setDeepQuery}
              onKeyDown={(e: any) => { if (e.key === 'Enter' && !deepSearching) handleDeepSearch(); }}
              placeholder="Describe the work you're looking for..." />
            {deepSearching
              ? <button className="btn-destructive" onClick={() => { abortRef.current = true; setDeepSearching(false); }}>Stop</button>
              : <button className="btn-primary" onClick={handleDeepSearch} disabled={!deepQuery.trim()}>Search</button>
            }
          </div>
          {deepSearching ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 0', gap: 12 }}>
              <div style={{ width: 32, height: 32, border: `3px solid ${subtle}`, borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
              <div style={{ fontSize: 15, color: muted }}>Searching transcripts...</div>
            </div>
          ) : deepError ? (
            <div style={{ color: muted, fontSize: 14, textAlign: 'center', padding: '32px 0', fontStyle: 'italic' }}>{deepError}</div>
          ) : deepResults.length > 0 ? (
            deepResults.map(s => <SessionRow key={s.id} s={s} globalSearch onResumeInApp={onResumeInApp} onClose={onClose} />)
          ) : (
            <div style={{ color: muted, fontSize: 14, textAlign: 'center', padding: '40px 0' }}>
              Describe what you worked on and the orchestrator will search your Claude and Copilot session transcripts.
            </div>
          )}
        </>
      ) : (
        <>
          <TextInput value={search} onChange={setSearch} placeholder="Search by name or ID..." />
          <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
            {cliFilterButtons.map(f => (
              <OptionButton key={f.key} selected={cliFilter === f.key} onClick={() => setCliFilter(f.key)}>{f.label}</OptionButton>
            ))}
          </div>
          <div style={{ marginTop: 16 }}>
            {loading ? (
              <div style={{ color: muted, fontSize: 14, textAlign: 'center', padding: '24px 0' }}>Loading sessions...</div>
            ) : filtered.length === 0 ? (
              <div style={{ color: subtle, fontSize: 14, textAlign: 'center', padding: '24px 0', fontStyle: 'italic' }}>
                {sessions.length === 0 ? 'No sessions found' : 'No sessions match search'}
              </div>
            ) : (
              filtered.map(s => <SessionRow key={s.id} s={s} globalSearch={mode === 'all'} onResumeInApp={onResumeInApp} onClose={onClose} />)
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
