'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useOrchestrator } from '@/lib/hooks/useOrchestrator';

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

function FolderPicker({ value, onChange }: { value: string; onChange: (path: string) => void }) {
  const [dirs, setDirs] = useState<{ name: string; path: string }[]>([]);
  const [open, setOpen] = useState(false);

  const loadDirs = useCallback(async (parentPath: string) => {
    try {
      const res = await fetch(`/api/dirs?path=${encodeURIComponent(parentPath)}`);
      const data = await res.json();
      setDirs(data.dirs || []);
    } catch { setDirs([]); }
  }, []);

  return (
    <div style={{ position: 'relative' }}>
      <div
        onClick={() => { setOpen(!open); if (!open) loadDirs(value); }}
        style={{
          width: '100%', background: '#1a1a2a', border: '1px solid #2a2a3e',
          color: '#eee', borderRadius: 6, padding: '10px 14px', fontSize: 15,
          fontFamily: 'inherit', cursor: 'pointer', display: 'flex',
          justifyContent: 'space-between', alignItems: 'center',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
        <span style={{ color: '#888', fontSize: 14 }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 110,
          background: '#1a1a2a', border: '1px solid #2a2a3e', borderRadius: 6,
          marginTop: 4, maxHeight: 220, overflowY: 'auto',
        }}>
          <div onClick={() => {
            const parent = value.split('/').slice(0, -1).join('/') || '/';
            onChange(parent); loadDirs(parent);
          }} style={{
            padding: '10px 14px', fontSize: 15, color: '#7aafff', cursor: 'pointer',
            borderBottom: '1px solid #222238',
          }}>
            ↑ Parent Directory
          </div>
          {dirs.map(d => (
            <div key={d.path} onClick={() => { onChange(d.path); setOpen(false); }} style={{
              padding: '10px 14px', fontSize: 15, color: '#d8d8e8', cursor: 'pointer',
              borderBottom: '1px solid #222238',
            }}
              onMouseEnter={e => e.currentTarget.style.background = '#222238'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              {d.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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
  s: SessionInfo;
  globalSearch: boolean;
  onResumeInApp?: (id: string) => void;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{
      background: '#161625', border: '1px solid #222238', borderRadius: 10,
      padding: '14px 16px', marginBottom: 10,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 17, fontWeight: 700, color: '#eee' }}>{s.name}</span>
        <span style={{ fontSize: 13, color: '#888' }}>{formatTimeAgo(s.lastModified)}</span>
      </div>
      {s.projectDir && globalSearch && (
        <div style={{ fontSize: 13, color: '#666', marginBottom: 6, fontFamily: "'Courier New', monospace" }}>
          {s.projectDir.replace(/^-/, '/').replace(/-/g, '/')}
        </div>
      )}
      <div style={{ fontSize: 12, color: '#555', marginBottom: 10, fontFamily: "'Courier New', monospace" }}>
        {s.id.slice(0, 12)}...
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {onResumeInApp && (
          <button onClick={() => { onResumeInApp(s.id); onClose(); }} style={{
            flex: 1, padding: '10px 14px', borderRadius: 8, border: 'none',
            background: '#4a9eff', color: '#fff', fontSize: 15, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>Resume in App</button>
        )}
        <button onClick={() => {
          navigator.clipboard.writeText(`claude --resume ${s.id}`);
          setCopied(true);
          setTimeout(() => setCopied(false), 3000);
        }} style={{
          flex: 1, padding: '10px 14px', borderRadius: 8, border: '1px solid #2a2a3e',
          background: copied ? '#1a3a1a' : '#1a1a2a',
          color: copied ? '#51cf66' : '#ccc', fontSize: 15, fontWeight: 600,
          cursor: 'pointer', fontFamily: 'inherit',
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

  // Direct ID resume
  const [directId, setDirectId] = useState('');
  const [directIdError, setDirectIdError] = useState('');
  const [resolving, setResolving] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  // Deep search
  const { query: queryOrchestrator } = useOrchestrator();
  const [deepQuery, setDeepQuery] = useState('');
  const [deepSearching, setDeepSearching] = useState(false);
  const [deepResults, setDeepResults] = useState<SessionInfo[]>([]);
  const [deepError, setDeepError] = useState('');
  const abortRef = useRef(false);

  const loadSessions = useCallback(async (path: string, isGlobal: boolean) => {
    setLoading(true);
    try {
      const url = isGlobal
        ? '/api/sessions/list?global=true'
        : `/api/sessions/list?cwd=${encodeURIComponent(path)}`;
      const res = await fetch(url);
      const data = await res.json();
      setSessions(data.sessions || []);
    } catch { setSessions([]); }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (isOpen && mode !== 'deep') loadSessions(cwd, mode === 'all');
  }, [isOpen, cwd, mode, loadSessions]);

  const handleCwdChange = (path: string) => {
    setCwd(path);
    if (mode === 'project') loadSessions(path, false);
  };

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

  // Deep search
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

    // Resolve each session ID to get name/project info
    const ids = result.lines
      .filter(l => /^[0-9a-f-]{8,}$/i.test(l.trim()))
      .map(l => l.trim())
      .slice(0, 10);

    if (ids.length === 0) {
      setDeepError('No matching sessions found');
      return;
    }

    // Resolve all IDs in parallel
    const resolved = await Promise.all(ids.map(async (id) => {
      try {
        const res = await fetch(`/api/sessions/resolve?id=${encodeURIComponent(id)}`);
        if (!res.ok) return null;
        const data = await res.json();
        return {
          id,
          name: data.name || `Session-${id.slice(0, 8)}`,
          slug: '',
          projectDir: data.projectDir,
          lastModified: Date.now(),
          active: false,
        } as SessionInfo;
      } catch { return null; }
    }));

    setDeepResults(resolved.filter(Boolean) as SessionInfo[]);
  }, [deepQuery, queryOrchestrator]);

  const handleStopSearch = useCallback(() => {
    abortRef.current = true;
    setDeepSearching(false);
  }, []);

  if (!isOpen) return null;

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
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 58,
      }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 650, maxHeight: '85vh', background: '#111118', border: '1px solid #222235',
        borderRadius: 14, zIndex: 59, display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 24px', borderBottom: '1px solid #1e1e30',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ fontSize: 20, fontWeight: 700, color: '#eee' }}>Resume Session</span>
          <button onClick={onClose} style={{
            width: 32, height: 32, borderRadius: 8, border: '1px solid #2a2a3e',
            background: '#1a1a2a', color: '#888', fontSize: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          }}>X</button>
        </div>

        {/* Resume by ID */}
        <div style={{ padding: '14px 24px', borderBottom: '1px solid #1e1e30' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            Resume by Session ID
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={directId}
              onChange={e => { setDirectId(e.target.value); setDirectIdError(''); }}
              onKeyDown={e => { if (e.key === 'Enter') handleDirectResume(); }}
              placeholder="Paste session UUID..."
              style={{
                flex: 1, background: '#1a1a2a', border: `1px solid ${directIdError ? '#ff4444' : '#2a2a3e'}`,
                color: '#eee', borderRadius: 8, padding: '10px 14px', fontSize: 14,
                fontFamily: "'Courier New', monospace",
              }}
            />
            {onResumeInApp && (
              <button onClick={handleDirectResume} disabled={resolving} style={{
                padding: '10px 16px', borderRadius: 8, border: 'none',
                background: resolving ? '#3a7acc' : '#4a9eff', color: '#fff', fontSize: 14, fontWeight: 600,
                cursor: resolving ? 'wait' : 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
                opacity: resolving ? 0.7 : 1,
              }}>
                {resolving ? 'Resolving...' : 'Resume'}
              </button>
            )}
          </div>
          {directIdError && <div style={{ fontSize: 12, color: '#ff6666', marginTop: 6 }}>{directIdError}</div>}
        </div>

        {/* Mode toggle */}
        <div style={{ padding: '14px 24px', borderBottom: '1px solid #1e1e30' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: mode === 'project' ? 10 : 0 }}>
            {modeButtons.map(m => (
              <button key={m.key} onClick={() => setMode(m.key)} style={{
                padding: '5px 14px', borderRadius: 6, fontSize: 14, fontWeight: 600,
                border: mode === m.key ? '1px solid #4a9eff' : '1px solid #2a2a3e',
                background: mode === m.key ? '#152540' : '#1a1a2a',
                color: mode === m.key ? '#7aafff' : '#888',
                cursor: 'pointer', fontFamily: 'inherit',
              }}>{m.label}</button>
            ))}
          </div>
          {mode === 'project' && <FolderPicker value={cwd} onChange={handleCwdChange} />}
        </div>

        {/* Content area */}
        {mode === 'deep' ? (
          <>
            {/* Deep search input */}
            <div style={{ padding: '14px 24px', borderBottom: '1px solid #1e1e30' }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={deepQuery}
                  onChange={e => setDeepQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !deepSearching) handleDeepSearch(); }}
                  placeholder="Describe the work you're looking for..."
                  style={{
                    flex: 1, background: '#1a1a2a', border: '1px solid #2a2a3e',
                    color: '#eee', borderRadius: 8, padding: '10px 14px', fontSize: 15,
                    fontFamily: 'inherit',
                  }}
                />
                {deepSearching ? (
                  <button onClick={handleStopSearch} style={{
                    padding: '10px 16px', borderRadius: 8, border: '1px solid #ff6b6b40',
                    background: '#1a0e0e', color: '#ff6b6b', fontSize: 14, fontWeight: 600,
                    cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
                  }}>Stop</button>
                ) : (
                  <button onClick={handleDeepSearch} disabled={!deepQuery.trim()} style={{
                    padding: '10px 16px', borderRadius: 8, border: 'none',
                    background: deepQuery.trim() ? '#4a9eff' : '#1e1e30',
                    color: deepQuery.trim() ? '#fff' : '#555',
                    fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                    whiteSpace: 'nowrap',
                  }}>Search</button>
                )}
              </div>
            </div>

            {/* Deep search results */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '14px 24px' }}>
              {deepSearching ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 0', gap: 12 }}>
                  <div style={{
                    width: 32, height: 32, border: '3px solid #2a2a3e', borderTopColor: '#4a9eff',
                    borderRadius: '50%', animation: 'spin 0.8s linear infinite',
                  }} />
                  <div style={{ fontSize: 16, color: '#aaa' }}>Searching transcripts...</div>
                  <div style={{ fontSize: 13, color: '#666' }}>Claude is analyzing session history</div>
                  <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                </div>
              ) : deepError ? (
                <div style={{ color: '#888', fontSize: 15, padding: 20, textAlign: 'center', fontStyle: 'italic' }}>
                  {deepError}
                </div>
              ) : deepResults.length > 0 ? (
                deepResults.map(s => (
                  <SessionRow key={s.id} s={s} globalSearch onResumeInApp={onResumeInApp} onClose={onClose} />
                ))
              ) : (
                <div style={{ color: '#666', fontSize: 15, padding: 40, textAlign: 'center' }}>
                  Describe what you worked on and Claude will search your session transcripts to find matching sessions.
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            {/* Regular search input */}
            <div style={{ padding: '10px 24px', borderBottom: '1px solid #1e1e30' }}>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by name or ID..."
                style={{
                  width: '100%', background: '#1a1a2a', border: '1px solid #2a2a3e',
                  color: '#eee', borderRadius: 8, padding: '10px 14px', fontSize: 15,
                  fontFamily: 'inherit',
                }}
              />
            </div>

            {/* Session list */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '14px 24px' }}>
              {loading ? (
                <div style={{ color: '#aaa', fontSize: 15, padding: 20, textAlign: 'center' }}>Loading sessions...</div>
              ) : filtered.length === 0 ? (
                <div style={{ color: '#777', fontSize: 15, padding: 20, textAlign: 'center', fontStyle: 'italic' }}>
                  {sessions.length === 0 ? 'No sessions found' : 'No sessions match search'}
                </div>
              ) : (
                filtered.map(s => (
                  <SessionRow key={s.id} s={s} globalSearch={mode === 'all'} onResumeInApp={onResumeInApp} onClose={onClose} />
                ))
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
