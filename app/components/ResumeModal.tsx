'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useOrchestrator } from '@/lib/hooks/useOrchestrator';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Modal, FormField, OptionGroup, OptionButton, TextInput } from './ui/Modal';
import { FolderPicker } from './ui/FolderPicker';

interface SessionInfo {
  id: string;
  name: string;
  slug: string;
  projectDir?: string;
  lastModified: number;
  active: boolean;
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
  const [copied, setCopied] = useState(false);
  return (
    <div className="bg-muted/30 border border-border/50 rounded-xl p-4 mb-2.5">
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-base font-bold text-foreground">{s.name}</span>
        <span className="text-xs text-muted-foreground">{formatTimeAgo(s.lastModified)}</span>
      </div>
      {s.projectDir && globalSearch && (
        <div className="text-xs text-muted-foreground mb-1.5 font-mono">
          {s.projectDir.replace(/^-/, '/').replace(/-/g, '/')}
        </div>
      )}
      <div className="text-xs text-muted-foreground/60 mb-3 font-mono">{s.id.slice(0, 12)}...</div>
      <div className="flex gap-2">
        {onResumeInApp && (
          <Button onClick={() => { onResumeInApp(s.id); onClose(); }} className="flex-1">
            Resume in App
          </Button>
        )}
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => {
            navigator.clipboard.writeText(`claude --resume ${s.id}`);
            setCopied(true);
            setTimeout(() => setCopied(false), 3000);
          }}
        >
          {copied ? '✓ Copied!' : 'Copy Command'}
        </Button>
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
      navigator.clipboard.writeText(`cd ${sessionCwd} && claude --resume ${id}`);
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
      `URGENT: Complete in under 60 seconds.`,
      `Find sessions related to: "${deepQuery.trim()}"`,
      `Use grep -rl on ~/.claude/projects/*/*.jsonl with keywords from the query.`,
      `Spawn maximum subagents to search project directories in parallel.`,
      `Session ID = filename without .jsonl. Output ONLY session IDs, one per line.`,
      `No explanation. No reasoning. No thinking. Just IDs.`,
      `If no matches output "NO_MATCHES". Max 10 results.`,
    ].join(' ');
    const result = await queryOrchestrator(instruction, 120000);
    if (abortRef.current) return;
    setDeepSearching(false);
    if (!result.success || result.lines.length === 0 || result.lines[0] === 'NO_MATCHES') {
      setDeepError('No matching sessions found');
      return;
    }
    const ids = result.lines.filter(l => /^[0-9a-f-]{8,}$/i.test(l.trim())).map(l => l.trim()).slice(0, 10);
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
    (!search || s.name.toLowerCase().includes(search.toLowerCase()) ||
     s.slug?.toLowerCase().includes(search.toLowerCase()) ||
     s.id.toLowerCase().includes(search.toLowerCase()))
  );

  const modeButtons: { key: SearchMode; label: string }[] = [
    { key: 'project', label: 'By Project' },
    { key: 'all', label: 'All Sessions' },
    { key: 'deep', label: 'Deep Search' },
  ];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Resume Session" width="max-w-[650px]">
      {/* Resume by ID */}
      <div className="pb-4 mb-4 border-b border-border/50">
        <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">
          Resume by Session ID
        </div>
        <div className="flex gap-2">
          <TextInput
            value={directId}
            onChange={(v) => { setDirectId(v); setDirectIdError(''); }}
            onKeyDown={(e: any) => { if (e.key === 'Enter') handleDirectResume(); }}
            placeholder="Paste session UUID..."
            mono
            error={!!directIdError}
          />
          {onResumeInApp && (
            <Button onClick={handleDirectResume} disabled={resolving}>
              {resolving ? 'Resolving...' : 'Resume'}
            </Button>
          )}
        </div>
        {directIdError && <div className="text-xs text-destructive mt-1.5">{directIdError}</div>}
      </div>

      {/* Mode toggle */}
      <div className="mb-4">
        <OptionGroup className="mb-3">
          {modeButtons.map(m => (
            <OptionButton key={m.key} selected={mode === m.key} onClick={() => setMode(m.key)}>
              {m.label}
            </OptionButton>
          ))}
        </OptionGroup>
        {mode === 'project' && <FolderPicker value={cwd} onChange={handleCwdChange} />}
      </div>

      {/* Content */}
      {mode === 'deep' ? (
        <>
          <div className="flex gap-2 mb-4">
            <TextInput
              value={deepQuery}
              onChange={setDeepQuery}
              onKeyDown={(e: any) => { if (e.key === 'Enter' && !deepSearching) handleDeepSearch(); }}
              placeholder="Describe the work you're looking for..."
            />
            {deepSearching ? (
              <Button variant="destructive" onClick={() => { abortRef.current = true; setDeepSearching(false); }}>Stop</Button>
            ) : (
              <Button onClick={handleDeepSearch} disabled={!deepQuery.trim()}>Search</Button>
            )}
          </div>
          {deepSearching ? (
            <div className="flex flex-col items-center py-10 gap-3">
              <div className="size-8 border-3 border-muted border-t-primary rounded-full animate-spin" />
              <div className="text-base text-foreground/60">Searching transcripts...</div>
              <div className="text-sm text-muted-foreground">Claude is analyzing session history</div>
            </div>
          ) : deepError ? (
            <div className="text-muted-foreground text-sm text-center py-8 italic">{deepError}</div>
          ) : deepResults.length > 0 ? (
            deepResults.map(s => <SessionRow key={s.id} s={s} globalSearch onResumeInApp={onResumeInApp} onClose={onClose} />)
          ) : (
            <div className="text-muted-foreground text-sm text-center py-10">
              Describe what you worked on and Claude will search your session transcripts.
            </div>
          )}
        </>
      ) : (
        <>
          <TextInput value={search} onChange={setSearch} placeholder="Search by name or ID..." />
          <div className="mt-4">
            {loading ? (
              <div className="text-foreground/60 text-sm text-center py-6">Loading sessions...</div>
            ) : filtered.length === 0 ? (
              <div className="text-muted-foreground text-sm text-center py-6 italic">
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
