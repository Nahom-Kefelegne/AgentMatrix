'use client';

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import type { SessionData, Action, CliType } from '@/lib/types';
import SessionConsole from './SessionConsole';
import HandoffModal from './HandoffModal';
import FullscreenTerminal from './FullscreenTerminal';
import ContextBar from './ContextBar';
import { useSocketContext } from './SocketProvider';
import { useSessionContext } from '@/lib/hooks/useSessionContext';
import { buildResumeShellCommand } from '@/lib/cli/uiMetadata';
import { cachedGetJson, invalidateCache } from '@/lib/clientCache';
import { perfRender } from '@/lib/perf';

const ChangesViewer = dynamic(() => import('./ChangesViewer'), { ssr: false });

/** CLI icon metadata */
const CLI_BADGE_META: Record<string, { svg: string; color: string; name: string }> = {
  claude: {
    svg: `<svg width="12" height="12" viewBox="0 0 248 248" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M52.4285 162.873L98.7844 136.879L99.5485 134.602L98.7844 133.334H96.4921L88.7237 132.862L62.2346 132.153L39.3113 131.207L17.0249 130.026L11.4214 128.844L6.2 121.873L6.7094 118.447L11.4214 115.257L18.171 115.847L33.0711 116.911L55.485 118.447L71.6586 119.392L95.728 121.873H99.5485L100.058 120.337L98.7844 119.392L97.7656 118.447L74.5877 102.732L49.4995 86.1905L36.3823 76.62L29.3779 71.7757L25.8121 67.2858L24.2839 57.3608L30.6515 50.2716L39.3113 50.8623L41.4763 51.4531L50.2636 58.1879L68.9842 72.7209L93.4357 90.6804L97.0015 93.6343L98.4374 92.6652L98.6571 91.9801L97.0015 89.2625L83.757 65.2772L69.621 40.8192L63.2534 30.6579L61.5978 24.632C60.9565 22.1032 60.579 20.0111 60.579 17.4246L67.8381 7.49965L71.9133 6.19995L81.7193 7.49965L85.7946 11.0443L91.9074 24.9865L101.714 46.8451L116.996 76.62L121.453 85.4816L123.873 93.6343L124.764 96.1155H126.292V94.6976L127.566 77.9197L129.858 57.3608L132.15 30.8942L132.915 23.4505L136.608 14.4708L143.994 9.62643L149.725 12.344L154.437 19.0788L153.8 23.4505L150.998 41.6463L145.522 70.1215L141.957 89.2625H143.994L146.414 86.7813L156.093 74.0206L172.266 53.698L179.398 45.6635L187.803 36.802L193.152 32.5484H203.34L210.726 43.6549L207.415 55.1159L196.972 68.3492L188.312 79.5739L175.896 96.2095L168.191 109.585L168.882 110.689L170.738 110.53L198.755 104.504L213.91 101.787L231.994 98.7149L240.144 102.496L241.036 106.395L237.852 114.311L218.495 119.037L195.826 123.645L162.07 131.592L161.696 131.893L162.137 132.547L177.36 133.925L183.855 134.279H199.774L229.447 136.524L237.215 141.605L241.8 147.867L241.036 152.711L229.065 158.737L213.019 154.956L175.45 145.977L162.587 142.787H160.805V143.85L171.502 154.366L191.242 172.089L215.82 195.011L217.094 200.682L213.91 205.172L210.599 204.699L188.949 188.394L180.544 181.069L161.696 165.118H160.422V166.772L164.752 173.152L187.803 207.771L188.949 218.405L187.294 221.832L181.308 223.959L174.813 222.777L161.187 203.754L147.305 182.486L136.098 163.345L134.745 164.2L128.075 235.42L125.019 239.082L117.887 241.8L111.902 237.31L108.718 229.984L111.902 215.452L115.722 196.547L118.779 181.541L121.58 162.873L123.291 156.636L123.14 156.219L121.773 156.449L107.699 175.752L86.304 204.699L69.3663 222.777L65.291 224.431L58.2867 220.768L58.9235 214.27L62.8713 208.48L86.304 178.705L100.44 160.155L109.551 149.507L109.462 147.967L108.959 147.924L46.6977 188.512L35.6182 189.93L30.7788 185.44L31.4156 178.115L33.7079 175.752L52.4285 162.873Z" fill="currentColor"/></svg>`,
    color: '#D97757',
    name: 'Claude Code',
  },
  copilot: {
    svg: `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M7.998 15.035c-4.562 0-7.873-2.914-7.998-3.749V9.338c.085-.628.677-1.686 1.588-2.065.013-.07.024-.143.036-.218.029-.183.06-.384.126-.612-.201-.508-.254-1.084-.254-1.656 0-.87.128-1.769.693-2.484.579-.733 1.494-1.124 2.724-1.261 1.206-.134 2.262.034 2.944.765.05.053.096.108.139.165.044-.057.094-.112.143-.165.682-.731 1.738-.899 2.944-.765 1.23.137 2.145.528 2.724 1.261.566.715.693 1.614.693 2.484 0 .572-.053 1.148-.254 1.656.066.228.098.429.126.612.012.076.024.148.037.218.924.385 1.522 1.471 1.591 2.095v1.872c0 .766-3.351 3.795-8.002 3.795Zm0-1.485c2.28 0 4.584-1.11 5.002-1.433V7.862l-.023-.116c-.49.21-1.075.291-1.727.291-1.146 0-2.059-.327-2.71-.991A3.222 3.222 0 0 1 8 6.303a3.24 3.24 0 0 1-.544.743c-.65.664-1.563.991-2.71.991-.652 0-1.236-.081-1.727-.291l-.023.116v4.255c.419.323 2.722 1.433 5.002 1.433ZM6.762 2.83c-.193-.206-.637-.413-1.682-.297-1.019.113-1.479.404-1.713.7-.247.312-.369.789-.369 1.554 0 .793.129 1.171.308 1.371.162.181.519.379 1.442.379.853 0 1.339-.235 1.638-.54.315-.322.527-.827.617-1.553.117-.935-.037-1.395-.241-1.614Zm4.155-.297c-1.044-.116-1.488.091-1.681.297-.204.219-.359.679-.242 1.614.091.726.303 1.231.618 1.553.299.305.784.54 1.638.54.922 0 1.28-.198 1.442-.379.179-.2.308-.578.308-1.371 0-.765-.123-1.242-.37-1.554-.233-.296-.693-.587-1.713-.7Z"/><path d="M6.25 9.037a.75.75 0 0 1 .75.75v1.501a.75.75 0 0 1-1.5 0V9.787a.75.75 0 0 1 .75-.75Zm4.25.75v1.501a.75.75 0 0 1-1.5 0V9.787a.75.75 0 0 1 1.5 0Z"/></svg>`,
    color: '#6E40C9',
    name: 'GitHub Copilot',
  },
};

function CliBadge({ cliType }: { cliType?: CliType }) {
  const type = cliType || 'claude';
  const meta = CLI_BADGE_META[type];
  if (!meta) return null;
  return (
    <span
      title={meta.name}
      style={{
        color: meta.color,
        display: 'inline-flex',
        alignItems: 'center',
        flexShrink: 0,
        opacity: 0.7,
      }}
      dangerouslySetInnerHTML={{ __html: meta.svg }}
    />
  );
}

const STATUS_COLORS: Record<string, string> = {
  idle: '#a1a1aa',
  working: '#34d399',
  meeting: '#a78bfa',
  attention: '#f59e0b',
  done: '#3b82f6',
};

function formatTimeAgo(timestamp?: number): string {
  if (!timestamp) return '';
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="section-label">{children}</div>;
}

function CopyButton({ text, label, successLabel }: { text: string; label: string; successLabel?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button className="btn-outline" onClick={(e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }} style={copied ? { borderColor: 'rgba(52,211,153,0.4)', color: '#34d399' } : undefined}>
      {copied ? (successLabel || 'Copied!') : label}
    </button>
  );
}

function RestartDialog({ command, onClose }: { command: string; onClose: () => void }) {
  return (
    <>
      <div onClick={onClose} className="modal-overlay" style={{ zIndex: 200 }} />
      <div className="modal-container" style={{ zIndex: 201, maxWidth: 520, padding: 24 }}>
        <div className="section-title" style={{ marginBottom: 8 }}>Session Restarted</div>
        <div className="section-desc">Paste this in your terminal to resume:</div>
        <div className="sub-panel" style={{
          fontFamily: 'monospace', fontSize: 14, wordBreak: 'break-all', lineHeight: 1.6, marginBottom: 16,
        }}>
          {command}
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <CopyButton text={command} label="Copy Command" />
          <button className="btn-outline" onClick={onClose}>Close</button>
        </div>
      </div>
    </>
  );
}

function MemorySection({ cwd }: { cwd?: string }) {
  const [notes, setNotes] = useState<{ filename: string; content: string }[]>([]);
  const [newNote, setNewNote] = useState('');
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const loadNotes = useCallback(async () => {
    if (!cwd) return;
    try {
      const res = await fetch(`/api/sessions/memory?cwd=${encodeURIComponent(cwd)}`);
      const data = await res.json();
      setNotes(data.notes || []);
    } catch {}
  }, [cwd]);

  useEffect(() => { loadNotes(); }, [loadNotes]);

  const handleAdd = async () => {
    if (!newNote.trim() || !cwd) return;
    setAdding(true);
    try {
      await fetch('/api/sessions/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd, filename: `note-${Date.now()}.md`, content: newNote.trim() }),
      });
      setNewNote('');
      loadNotes();
    } catch {}
    setAdding(false);
  };

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <SectionLabel>Memory Notes</SectionLabel>
        <button onClick={() => { loadNotes(); setExpanded(!expanded); }} style={{
          fontSize: 14, color: '#7aafff', background: 'none', border: 'none',
          cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit',
        }}>
          {expanded ? 'Hide' : `View (${notes.length})`}
        </button>
      </div>

      {expanded && notes.length > 0 && (
        <div style={{ marginBottom: 10, maxHeight: 200, overflowY: 'auto' }}>
          {notes.map((n, i) => (
            <div key={i} style={{
              background: '#12121e', border: '1px solid #1e1e30', borderRadius: 6,
              padding: '10px 12px', marginBottom: 6,
            }}>
              <div style={{ fontSize: 13, color: '#888', marginBottom: 4, fontFamily: "'Courier New', monospace" }}>
                {n.filename}
              </div>
              <pre style={{
                fontSize: 14, color: '#d8d8e8', margin: 0, whiteSpace: 'pre-wrap',
                wordBreak: 'break-word', fontFamily: "'Courier New', monospace", lineHeight: 1.5,
              }}>
                {n.content}
              </pre>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <textarea
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleAdd())}
          placeholder="Add a memory note..."
          rows={2}
          style={{
            flex: 1, background: '#12121e', border: '1px solid #1e1e30',
            color: '#ddd', borderRadius: 6, padding: '8px 10px', fontSize: 14,
            fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.4,
          }}
        />
        <button onClick={handleAdd} disabled={adding || !newNote.trim()} style={{
          padding: '0 16px', borderRadius: 6, border: 'none',
          background: newNote.trim() ? '#4a9eff' : '#1e1e30',
          color: newNote.trim() ? '#fff' : '#555',
          fontSize: 13, fontWeight: 600, cursor: newNote.trim() ? 'pointer' : 'default',
          fontFamily: 'inherit', flexShrink: 0,
          transition: 'all 0.15s',
        }}>
          Add
        </button>
      </div>
    </div>
  );
}

interface McpRegistryItem {
  id: string; name: string; description: string; package: string;
  command: string; args: string[]; env?: Record<string, string>; category: string;
}

function McpSection() {
  const [installed, setInstalled] = useState<Record<string, unknown>>({});
  const [registry, setRegistry] = useState<McpRegistryItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showStore, setShowStore] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [mcpData, regData] = await Promise.all([
        cachedGetJson<{ servers?: Record<string, unknown> }>('/api/sessions/mcp'),
        cachedGetJson<{ servers?: McpRegistryItem[] }>('/api/sessions/mcp/registry'),
      ]);
      setInstalled(mcpData.servers || {});
      setRegistry(regData.servers || []);
    } catch {}
    setLoaded(true);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleInstall = async (server: McpRegistryItem) => {
    setInstalling(server.id);
    try {
      const updated = { ...installed };
      const config: Record<string, unknown> = { command: server.command, args: server.args };
      if (server.env) config.env = server.env;
      (updated as Record<string, unknown>)[server.id] = config;
      await fetch('/api/sessions/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ servers: updated }),
      });
      invalidateCache('/api/sessions/mcp');
      setInstalled(updated);
    } catch {}
    setInstalling(null);
  };

  const handleRemove = async (name: string) => {
    const updated = { ...installed };
    delete (updated as Record<string, unknown>)[name];
    try {
      await fetch('/api/sessions/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ servers: updated }),
      });
      invalidateCache('/api/sessions/mcp');
      setInstalled(updated);
    } catch {}
  };

  const installedNames = Object.keys(installed);
  const availableServers = registry.filter(s => !installedNames.includes(s.id));

  if (!loaded) return null;

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <SectionLabel>MCP Servers</SectionLabel>
        <button onClick={() => setShowStore(!showStore)} style={{
          fontSize: 14, color: '#7aafff', background: 'none', border: 'none',
          cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit',
        }}>
          {showStore ? 'Hide Store' : '+ Add Server'}
        </button>
      </div>

      {installedNames.length > 0 && (
        <div style={{
          background: '#12121e', borderRadius: 6, border: '1px solid #1e1e30', marginBottom: 8,
        }}>
          {installedNames.map((name, i) => (
            <div key={name} style={{
              padding: '10px 12px', fontSize: 15, color: '#d0d0e0',
              borderBottom: i < installedNames.length - 1 ? '1px solid #1a1a2a' : 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%', background: '#51cf66',
                  display: 'inline-block',
                }} />
                <span style={{ fontWeight: 600 }}>{name}</span>
              </div>
              <button onClick={() => handleRemove(name)} style={{
                fontSize: 12, color: '#ff6b6b', background: 'none', border: 'none',
                cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
              }}>
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {installedNames.length === 0 && !showStore && (
        <div style={{ fontSize: 14, color: '#888', fontStyle: 'italic', marginBottom: 8 }}>
          No MCP servers installed
        </div>
      )}

      {showStore && (
        <div style={{
          background: '#12121e', borderRadius: 6, border: '1px solid #1e1e30',
          maxHeight: 220, overflowY: 'auto',
        }}>
          {availableServers.length === 0 ? (
            <div style={{ padding: '12px 14px', fontSize: 14, color: '#888', fontStyle: 'italic' }}>
              All servers installed
            </div>
          ) : availableServers.map((server, i) => (
            <div key={server.id} style={{
              padding: '10px 12px',
              borderBottom: i < availableServers.length - 1 ? '1px solid #1a1a2a' : 'none',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 15, fontWeight: 600, color: '#eee' }}>{server.name}</span>
                <button
                  onClick={() => handleInstall(server)}
                  disabled={installing === server.id}
                  style={{
                    fontSize: 12, padding: '3px 10px', borderRadius: 4, border: 'none',
                    background: '#4a9eff', color: '#fff', fontWeight: 600, cursor: 'pointer',
                    fontFamily: 'inherit',
                    opacity: installing === server.id ? 0.5 : 1,
                  }}
                >
                  {installing === server.id ? '...' : 'Install'}
                </button>
              </div>
              <div style={{ fontSize: 14, color: '#aaa', marginTop: 3 }}>{server.description}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ fontSize: 13, color: '#888', marginTop: 6, fontStyle: 'italic' }}>
        Restart session after changes
      </div>
    </div>
  );
}

// ===== Main SessionDialog =====

interface SessionDialogProps {
  sessionId: string | null;
  sessions: Map<string, SessionData>;
  onClose: () => void;
  noBackdrop?: boolean;
  onPrev?: () => void;
  onNext?: () => void;
  sessionIndex?: number;
  sessionTotal?: number;
  readOnly?: boolean;
  onSelectSession?: (sessionId: string) => void;
  onOpenTask?: (taskId: string) => void;
}

export default function SessionDialog({
  sessionId, sessions, onClose, noBackdrop,
  onPrev, onNext, sessionIndex, sessionTotal, readOnly, onSelectSession, onOpenTask,
}: SessionDialogProps) {
  perfRender('SessionDialog');
  const { socketRef } = useSocketContext();
  const [activeTab, setActiveTab] = useState<'console' | 'tasks' | 'info' | 'settings'>('console');
  const [killing, setKilling] = useState(false);
  const [restartCommand, setRestartCommand] = useState<string | null>(null);
  const [showHandoff, setShowHandoff] = useState(false);
  const [handoffActive, setHandoffActive] = useState(false);
  const [showChanges, setShowChanges] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [terminalFullscreen, setTerminalFullscreen] = useState(false);
  const isConsole = activeTab === 'console';
  // Lazy-mount non-console tab bodies: only render a tab after it's first been
  // activated (then keep it mounted to preserve state). This keeps the tab
  // components' on-mount fetches (memory / mcp / mcp-registry / app-tasks) OFF
  // the console-open critical path — opening a session no longer fires them.
  const [visitedTabs, setVisitedTabs] = useState<Set<string>>(() => new Set(['console']));
  useEffect(() => {
    setVisitedTabs(prev => (prev.has(activeTab) ? prev : new Set(prev).add(activeTab)));
  }, [activeTab]);

  useEffect(() => {
    setActiveTab('console');
    setShowHandoff(false);
    setVisitedTabs(new Set(['console']));
  }, [sessionId]);
  // If console tab was active but session is no longer managed, switch to info

  if (!sessionId) return null;
  const session = sessions.get(sessionId);
  if (!session) return null;

  const statusColor = STATUS_COLORS[session.status] || STATUS_COLORS.idle;
  const isWorking = session.status === 'working';

  const handleKill = async () => {
    if (!confirm(`Fire "${session.name}"?`)) return;
    setKilling(true);
    try {
      await fetch('/api/sessions/kill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.id }),
      });
      onClose();
    } catch (err) {
      console.error('Failed to kill session:', err);
    } finally {
      setKilling(false);
    }
  };

  const handleRestart = async () => {
    if (!confirm(`Restart "${session.name}"?`)) return;
    const socket = socketRef.current;
    if (!socket) return;
    // End current session, then resume it after PTY cleanup
    socket.emit('terminal:end' as any, { sessionId: session.id });
    setTimeout(() => {
      socket.emit('terminal:resume' as any, { sessionId: session.id });
    }, 5000);
  };

  const cliType = session.cliType || 'claude';
  // Claude can resume by name; Copilot resumes by ID. Match provider behavior.
  const resumeToken = cliType === 'copilot' ? session.id : session.name;
  const cliCmd = `cd ${session.cwd || '~'} && ${buildResumeShellCommand({ cliType, resumeId: resumeToken })}`;

  return (
    <>
      {/* Backdrop */}
      {!noBackdrop && (
        <div onClick={onClose} className="session-dialog-backdrop" />
      )}

      {/* Dialog */}
      <div
        className={`session-dialog ${fullscreen ? 'session-dialog--fullscreen' : ''}`}
        style={{
          width: fullscreen ? undefined : isConsole ? 1100 : 900,
          height: fullscreen ? undefined : '90vh',
          transition: 'width 0.2s ease, height 0.2s ease',
        }}
      >
        {/* Header */}
        <div className="session-dialog-header">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 12, height: 12, borderRadius: '50%',
                backgroundColor: statusColor,
                boxShadow: isWorking ? `0 0 8px ${statusColor}60` : 'none',
              }} />
              <CliBadge cliType={session.cliType} />
              <span className="session-dialog-name">{session.name}</span>
              <span style={{
                fontSize: 12, fontWeight: 600, color: statusColor,
                textTransform: 'uppercase', letterSpacing: 0.5,
                padding: '2px 8px', borderRadius: 6,
                background: `${statusColor}15`,
              }}>
                {session.status}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {onPrev && onNext && sessionTotal !== undefined && sessionIndex !== undefined && (
                <>
                  <button className="session-dialog-icon-btn" onClick={(e) => { e.stopPropagation(); onPrev(); }}>‹</button>
                  <span className="muted-text" style={{ fontSize: 14, minWidth: 55, textAlign: 'center', fontWeight: 600 }}>
                    {sessionIndex + 1} of {sessionTotal}
                  </span>
                  <button className="session-dialog-icon-btn" onClick={(e) => { e.stopPropagation(); onNext(); }}>›</button>
                </>
              )}
            <button className="session-dialog-icon-btn" onClick={() => setFullscreen(f => !f)} title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
              {fullscreen ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
              )}
            </button>
            <button className="session-dialog-icon-btn" onClick={onClose}>✕</button>
            </div>
          </div>

          {/* Quick info row under name removed — the cwd now lives inline in
              the tab bar's otherwise-empty right side to save vertical space
              for the console. */}
        </div>

        {/* Tabs (+ inline cwd path on the right, reclaiming empty header space) */}
        <div className="session-dialog-tab-bar" style={{ justifyContent: 'space-between' }}>
          <div style={{ display: 'flex' }}>
            {(['console', 'tasks', 'info', 'settings'] as const).map(tab => {
              const labels: Record<string, string> = { console: 'Console', tasks: 'Tasks', info: 'Info', settings: 'Settings' };
              return (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className={`session-dialog-tab ${activeTab === tab ? 'session-dialog-tab--active' : ''}`}>
                  {labels[tab]}
                </button>
              );
            })}
          </div>
          {session.cwd && (
            <div className="session-dialog-path session-dialog-path--inline" title={session.cwd}>{session.cwd}</div>
          )}
        </div>

        {/* Content — all tabs stay mounted to preserve state */}
        <div style={{
          flex: 1, minHeight: 0, position: 'relative',
        }}>
          <div style={{
            position: 'absolute', inset: 0, padding: '8px 12px',
            display: activeTab === 'console' ? 'flex' : 'none',
            flexDirection: 'column',
            willChange: 'transform',
          }}>
            <SessionConsole sessionId={session.id} sessionName={session.name} cwd={session.cwd} visible={activeTab === 'console' && !terminalFullscreen} readOnly={readOnly} cliType={session.cliType} />
            {/* Terminal fullscreen — floating top-right corner */}
            <button
              className="terminal-fullscreen-btn"
              onClick={() => setTerminalFullscreen(true)}
              title="Fullscreen terminal"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
              </svg>
            </button>
          </div>
          <div style={{
            position: 'absolute', inset: 0, padding: '20px 24px',
            overflowY: 'auto',
            display: activeTab === 'tasks' ? 'block' : 'none',
          }}>
            {visitedTabs.has('tasks') && (
              <TasksTab sessionId={session.id} socketRef={socketRef} onOpenTask={onOpenTask} onSwitchToConsole={() => setActiveTab('console')} />
            )}
          </div>
          <div style={{
            position: 'absolute', inset: 0, padding: '20px 24px',
            overflowY: 'auto',
            display: activeTab === 'info' ? 'block' : 'none',
          }}>
            {visitedTabs.has('info') && (
              <InfoTab session={session} cliCmd={cliCmd} socketRef={socketRef} onSelectSession={onSelectSession} />
            )}
          </div>
          <div style={{
            position: 'absolute', inset: 0, padding: '20px 24px',
            overflowY: 'auto',
            display: activeTab === 'settings' ? 'block' : 'none',
          }}>
            {visitedTabs.has('settings') && (
              <SettingsTab session={session} socketRef={socketRef} />
            )}
          </div>
        </div>

        {/* Bottom bar */}
        {readOnly ? (
          <div className="session-dialog-footer">
            <span className="subtle-text" style={{ fontSize: 12, fontStyle: 'italic' }}>Read-only view</span>
          </div>
        ) : null}
        {!readOnly && (
          <div className="session-dialog-footer">
            <button className="action-btn action-btn--blue" onClick={() => setShowChanges(true)}>View Changes</button>
            <button className={`action-btn ${handoffActive ? 'action-btn--yellow' : 'action-btn--purple'}`}
              onClick={() => setShowHandoff(true)}>
              {handoffActive ? 'Transfer in Progress...' : 'Transfer Context'}
            </button>
            <div style={{ flex: 1 }} />
            <button className="action-btn action-btn--green" onClick={handleRestart}>Restart</button>
            <button className="action-btn action-btn--red" disabled={killing}
              style={{ opacity: killing ? 0.5 : 1, cursor: killing ? 'not-allowed' : 'pointer' }}
              onClick={() => {
                if (!confirm(`End "${session.name}"?`)) return;
                setKilling(true);
                const socket = socketRef.current;
                if (socket) socket.emit('terminal:end' as any, { sessionId: session.id });
                setTimeout(() => { setKilling(false); onClose(); }, 4500);
              }}>
              {killing ? 'Ending...' : 'End Session'}
            </button>
          </div>
        )}
      </div>

      {/* Terminal fullscreen overlay */}
      {terminalFullscreen && (
        <FullscreenTerminal
          session={session}
          sessions={sessions}
          readOnly={readOnly}
          onExit={() => setTerminalFullscreen(false)}
        />
      )}

      <HandoffModal
        isOpen={showHandoff}
        onClose={() => setShowHandoff(false)}
        sourceSessionId={session.id}
        sourceCwd={session.cwd}
        onStatusChange={(active) => setHandoffActive(active)}
        onNewSession={(newId) => {
          setShowHandoff(false);
          setHandoffActive(false);
          if (onSelectSession) onSelectSession(newId);
        }}
      />

      {restartCommand && (
        <RestartDialog command={restartCommand} onClose={() => setRestartCommand(null)} />
      )}

      {/* Lazy-mount: only render ChangesViewer when the user actually opens the
          changes tab. It was previously always mounted (display:none), so every
          console open fired its transcript-diff fetch (/api/sessions/changes,
          ~2s on Windows) plus /api/sessions/comments — and re-fetched on every
          tool-complete while hidden. Mounting on demand keeps console-open fast. */}
      {showChanges && (
        <ChangesViewer
          sessionId={session.id}
          sessionName={session.name}
          cwd={session.cwd}
          onClose={() => setShowChanges(false)}
          socketRef={socketRef}
          onSwitchToConsole={() => setActiveTab('console')}
        />
      )}
    </>
  );
}

// ChangesViewer is now imported from './ChangesViewer'

// ===== Tasks Tab =====

const TASK_TYPE_ICONS: Record<string, string> = {
  Bug: '\uD83D\uDD34', Task: '\u2705', 'User Story': '\uD83D\uDCD6',
  Feature: '\u2B50', Epic: '\uD83C\uDFD4\uFE0F', Issue: '\u26A0\uFE0F',
};

const TASK_STATE_COLORS: Record<string, string> = {
  Proposed: '#4a9eff', Active: '#ffd43b', Resolved: '#51cf66', Closed: '#888',
};

function TasksTab({ sessionId, socketRef, onOpenTask, onSwitchToConsole }: { sessionId: string; socketRef: React.RefObject<any>; onOpenTask?: (taskId: string) => void; onSwitchToConsole?: () => void }) {
  const [tasks, setTasks] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/app-tasks');
      if (res.ok) {
        const data = await res.json();
        setTasks((data.tasks || []).filter((t: Record<string, unknown>) => t.assignedTo === sessionId));
      }
    } catch {}
    setLoading(false);
  }, [sessionId]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  const handleTaskClick = useCallback((taskId: string) => {
    if (onOpenTask) onOpenTask(taskId);
  }, [onOpenTask]);

  const handleSyncWithClaude = useCallback(async (task: Record<string, unknown>) => {
    try {
      const writeRes = await fetch('/api/app-tasks/assign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId, taskId: task.id, subject: task.subject,
          description: task.description, type: task.type,
          priority: task.priority, discussions: task.discussions,
        }),
      });
      const { filePath } = await writeRes.json();
      const socket = socketRef.current;
      if (socket) {
        socket.emit('terminal:input', {
          sessionId,
          data: `Read the updated task details at ${filePath}. Sync your understanding of this task with the new information. Delete the file when done.\r`,
        });
      }
      setTimeout(() => {
        fetch('/api/app-tasks/assign', {
          method: 'DELETE', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, taskId: task.id }),
        }).catch(() => {});
      }, 60000);

      // Switch to console tab
      if (onSwitchToConsole) onSwitchToConsole();
    } catch {}
  }, [sessionId, socketRef, onSwitchToConsole]);

  if (loading) {
    return <div style={{ fontSize: 15, padding: 20, textAlign: 'center', opacity: 0.6 }}>Loading...</div>;
  }

  if (tasks.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 0', gap: 12 }}>
        <div style={{ fontSize: 16, opacity: 0.5 }}>No tasks assigned to this session</div>
        <div style={{ fontSize: 14, color: '#444' }}>Assign tasks from the Task Board</div>
      </div>
    );
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 14, color: '#888', fontWeight: 600 }}>{tasks.length} task{tasks.length !== 1 ? 's' : ''}</div>
        <button onClick={fetchTasks} style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #2a2a3e', background: '#1a1a2a', color: '#aaa', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Refresh</button>
      </div>

      <div style={{ background: '#12121e', borderRadius: 10, border: '1px solid #1e1e30', overflow: 'hidden' }}>
        {tasks.map((task: Record<string, unknown>, i: number) => {
          const icon = TASK_TYPE_ICONS[(task.type as string) || ''] || '';
          const state = (task.state || task.adoState || 'Proposed') as string;
          return (
            <div key={task.id as string} onClick={() => handleTaskClick(task.id as string)} style={{
              padding: '12px 14px', borderBottom: i < tasks.length - 1 ? '1px solid #1a1a28' : 'none',
              cursor: 'pointer', transition: 'background 0.1s',
            }}
              onMouseEnter={e => e.currentTarget.style.background = '#1a1a2e'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {icon && <span style={{ fontSize: 13 }}>{icon}</span>}
                <span style={{ fontSize: 15, color: '#eee', fontWeight: 700 }}>{task.subject as string}</span>
              </div>
              {task.description ? <div style={{ fontSize: 13, opacity: 0.6, marginTop: 4, fontWeight: 500 }}>{(task.description as string).slice(0, 80)}</div> : null}
              <div style={{ display: 'flex', gap: 5, marginTop: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: (TASK_STATE_COLORS[state] || '#888') + '15', color: TASK_STATE_COLORS[state] || '#888', fontWeight: 700 }}>{state}</span>
                {task.adoId ? <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: '#4a9eff10', color: '#4a9eff', fontWeight: 700 }}>#{task.adoId as number}</span> : null}
                <button onClick={(e) => { e.stopPropagation(); handleSyncWithClaude(task); }} style={{
                  marginLeft: 'auto', padding: '2px 8px', borderRadius: 4, border: '1px solid #51cf6630',
                  background: 'transparent', color: '#51cf66', fontSize: 10, fontWeight: 700, cursor: 'pointer',
                }}>Sync</button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ===== Info Tab =====

function ActionRow({ action, isLast }: { action: Action; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const summary = action.summary || action.toolName;

  return (
    <div
      onClick={() => setExpanded(!expanded)}
      style={{
        padding: '10px 14px',
        borderBottom: isLast ? 'none' : '1px solid #1a1a28',
        cursor: 'pointer',
        transition: 'background 0.1s',
        background: expanded ? '#161625' : 'transparent',
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{
          color: '#888', fontSize: 11, flexShrink: 0,
          transform: expanded ? 'rotate(90deg)' : 'none',
          transition: 'transform 0.15s',
          display: 'inline-block',
        }}>
          &#9656;
        </span>
        <span style={{ fontWeight: 600, color: '#8ab4e0', fontSize: 14, flexShrink: 0 }}>
          {action.toolName}
        </span>
        {!expanded && (
          <span style={{
            flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            color: '#bbb', fontSize: 14,
          }}>
            {summary}
          </span>
        )}
        <span style={{ fontSize: 13, color: '#888', flexShrink: 0, marginLeft: 'auto' }}>
          {formatTimeAgo(action.timestamp)}
        </span>
      </div>
      {expanded && (
        <div style={{
          marginTop: 8, marginLeft: 20, padding: '8px 12px',
          background: '#0e0e18', borderRadius: 6, border: '1px solid #1a1a28',
          fontSize: 14, color: '#d0d0e0', lineHeight: 1.5,
          wordBreak: 'break-word', fontFamily: "'Courier New', monospace",
        }}>
          {summary}
        </div>
      )}
    </div>
  );
}

function ForkSection({ session, socketRef, onSelectSession }: {
  session: SessionData; socketRef: React.RefObject<any>;
  onSelectSession?: (id: string) => void;
}) {
  const [forking, setForking] = useState(false);
  const [forkName, setForkName] = useState('');

  const handleFork = useCallback(() => {
    const socket = socketRef.current;
    if (!socket) return;
    setForking(true);

    const handler = (data: { sessionId: string; name: string }) => {
      socket.off('terminal:forked' as any, handler);
      setForking(false);
      // Navigate to the new forked session
      if (onSelectSession) onSelectSession(data.sessionId);
    };
    socket.on('terminal:forked' as any, handler);

    socket.emit('terminal:fork' as any, {
      sourceSessionId: session.id,
      name: forkName.trim() || undefined,
    });

    setTimeout(() => {
      socket.off('terminal:forked' as any, handler);
      setForking(false);
    }, 10000);
  }, [socketRef, session.id, forkName, onSelectSession]);

  return (
    <div style={{ marginBottom: 20 }}>
      <SectionLabel>Fork Session</SectionLabel>
      <div style={{ fontSize: 14, marginBottom: 10 }} className="section-desc">
        Create a new session branching from this one. The fork gets the full conversation context but runs independently.
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input
          className="form-input"
          value={forkName}
          onChange={e => setForkName(e.target.value)}
          placeholder={`Fork of ${session.name}`}
          style={{ flex: 1, fontSize: 14 }}
        />
        <button
          className="btn-primary"
          onClick={handleFork}
          disabled={forking}
          style={{ flexShrink: 0, opacity: forking ? 0.6 : 1 }}
        >
          {forking ? 'Forking...' : 'Fork'}
        </button>
      </div>
    </div>
  );
}

function InfoTab({ session, cliCmd, socketRef, onSelectSession }: {
  session: SessionData; cliCmd: string;
  socketRef: React.RefObject<any>; onSelectSession?: (id: string) => void;
}) {
  // Subscribe to context usage HERE (not in SessionDialog) so streaming
  // session:context events only re-render this tab — which is lazy-mounted and
  // usually not visible — instead of the whole dialog + console subtree.
  const { connected } = useSocketContext();
  const contextMap = useSessionContext(socketRef, connected);
  const contextUsage = contextMap[session.id] ?? null;
  const [summaryLoading, setSummaryLoading] = useState(false);

  useEffect(() => {
    if (session.summaryBullets && session.summaryBullets.length > 0) {
      setSummaryLoading(false);
    }
  }, [session.summaryBullets]);

  const handleRefreshSummary = useCallback(() => {
    const socket = socketRef.current;
    if (!socket) return;
    setSummaryLoading(true);
    socket.emit('session:summary', { sessionId: session.id });
    setTimeout(() => setSummaryLoading(false), 60000);
  }, [socketRef, session.id]);

  return (
    <>
      {/* Work summary */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <SectionLabel>Work Summary</SectionLabel>
          <button onClick={handleRefreshSummary} disabled={summaryLoading} style={{
            fontSize: 13, color: summaryLoading ? '#555' : '#4a9eff', background: 'none', border: 'none',
            cursor: summaryLoading ? 'wait' : 'pointer', fontWeight: 600, fontFamily: 'inherit',
          }}>
            {summaryLoading ? 'Generating...' : 'Refresh'}
          </button>
        </div>
        {session.summaryBullets && session.summaryBullets.length > 0 ? (
          <div style={{
            background: '#12121e', borderRadius: 8, border: '1px solid #1e1e30',
            padding: '12px 14px',
          }}>
            {session.summaryBullets.map((bullet, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 14 }}>
                <span style={{ color: '#4a9eff', fontSize: 8, flexShrink: 0 }}>●</span>
                <span style={{ color: '#ccc' }}>{bullet}</span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 14, opacity: 0.5, fontStyle: 'italic' }}>
            {summaryLoading ? 'Asking session for summary...' : 'Click Refresh to generate summary'}
          </div>
        )}
      </div>

      {/* Context usage */}
      {contextUsage !== null && (
        <div style={{ marginBottom: 20 }}>
          <ContextBar usage={contextUsage} />
        </div>
      )}

      {/* Working on — prominent when active */}
      {session.status === 'working' && session.lastToolSummary && (
        <div style={{
          padding: '14px 16px',
          background: '#0e1a2e',
          borderRadius: 10,
          border: '1px solid #1a3050',
          marginBottom: 20,
        }}>
          <div style={{ fontSize: 12, color: '#6a9ad0', textTransform: 'uppercase', fontWeight: 700, letterSpacing: 1, marginBottom: 6 }}>
            Currently Working On
          </div>
          <div style={{
            fontSize: 17, color: '#b0d8ff', fontWeight: 600,
            fontFamily: "'Courier New', monospace",
          }}>
            {session.lastToolSummary}
          </div>
          {session.currentTool && (
            <div style={{ fontSize: 14, color: '#6a9ad0', marginTop: 4 }}>
              Tool: {session.currentTool}
            </div>
          )}
        </div>
      )}

      {/* Status + last activity */}
      <div style={{
        display: 'flex', gap: 12, marginBottom: 20,
      }}>
        <div style={{
          flex: 1, padding: '12px 14px', background: '#12121e', borderRadius: 8,
          border: '1px solid #1e1e30',
        }}>
          <div style={{ fontSize: 12, color: '#999', textTransform: 'uppercase', fontWeight: 700, letterSpacing: 1, marginBottom: 6 }}>
            Status
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              backgroundColor: STATUS_COLORS[session.status],
            }} />
            <span style={{
              fontSize: 15, fontWeight: 600,
              color: STATUS_COLORS[session.status],
              textTransform: 'capitalize',
            }}>
              {session.status}
            </span>
          </div>
        </div>
        <div style={{
          flex: 1, padding: '12px 14px', background: '#12121e', borderRadius: 8,
          border: '1px solid #1e1e30',
        }}>
          <div style={{ fontSize: 12, color: '#999', textTransform: 'uppercase', fontWeight: 700, letterSpacing: 1, marginBottom: 6 }}>
            Last Activity
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#ddd' }}>
            {session.lastActivity ? formatTimeAgo(session.lastActivity) : 'N/A'}
          </div>
        </div>
        <div style={{
          flex: 1, padding: '12px 14px', background: '#12121e', borderRadius: 8,
          border: '1px solid #1e1e30',
        }}>
          <div style={{ fontSize: 12, color: '#999', textTransform: 'uppercase', fontWeight: 700, letterSpacing: 1, marginBottom: 6 }}>
            Agents
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#ddd' }}>
            {session.agents?.length || 0}
          </div>
        </div>
      </div>

      {/* Agent Team */}
      {session.agents && session.agents.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <SectionLabel>Agent Team{session.teamId ? ` — ${session.teamId}` : ''} ({session.agents.length})</SectionLabel>
          <div style={{
            background: '#12121e', borderRadius: 8, border: '1px solid #1e1e30',
            overflow: 'hidden',
          }}>
            {session.agents.map((agent, i) => (
              <div key={agent.id} style={{
                padding: '10px 14px', fontSize: 15, color: '#d0d0e0',
                borderBottom: i < session.agents.length - 1 ? '1px solid #1a1a28' : 'none',
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%',
                  backgroundColor: STATUS_COLORS[agent.status] || STATUS_COLORS.idle,
                  display: 'inline-block', flexShrink: 0,
                }} />
                <span style={{ fontWeight: 600, color: agent.color }}>{agent.name}</span>
                <span style={{ fontSize: 13, color: '#888', textTransform: 'uppercase' }}>
                  {agent.status}
                </span>
                {agent.currentTool && (
                  <span style={{ fontSize: 14, color: '#8ab8ff', marginLeft: 'auto' }}>
                    {agent.currentTool}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Fork Session */}
      <ForkSection session={session} socketRef={socketRef} onSelectSession={onSelectSession} />

      {/* Recent Actions */}
      {session.recentActions.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <SectionLabel>Recent Actions ({session.recentActions.length})</SectionLabel>
          <div style={{
            background: '#12121e', borderRadius: 8, border: '1px solid #1e1e30',
            overflow: 'hidden',
          }}>
            {session.recentActions.map((action: Action, i: number) => (
              <ActionRow
                key={i}
                action={action}
                isLast={i === session.recentActions.length - 1}
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// ===== Settings Tab =====

function SettingsTab({ session, socketRef }: {
  session: SessionData;
  socketRef: React.RefObject<any>;
}) {
  const [renameValue, setRenameValue] = useState(session.name);
  const [renameStatus, setRenameStatus] = useState<'' | 'saving' | 'saved'>('');

  const handleRename = async () => {
    const newName = renameValue.trim();
    if (!newName || newName === session.name) return;
    setRenameStatus('saving');
    // Claude renames in-TUI via the `/rename` slash command, so inject it into
    // the PTY. Copilot has no working rename slash command — it's renamed on
    // disk by the API (workspace.yaml write), so we must NOT inject anything
    // (it would just be typed as a stray chat message).
    const socket = socketRef.current;
    if (socket && (session.cliType || 'claude') !== 'copilot') {
      socket.emit('terminal:input' as any, {
        sessionId: session.id,
        data: `/rename ${newName}\r`,
      });
    }
    // Persist: cache + store for both CLIs, plus provider-owned disk rename
    // (workspace.yaml for Copilot).
    await fetch('/api/sessions/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, name: newName, cliType: session.cliType }),
    });
    setRenameStatus('saved');
    setTimeout(() => setRenameStatus(''), 2000);
  };

  return (
    <>
      {/* Rename */}
      <div style={{ marginBottom: 20 }}>
          <SectionLabel>Rename Session</SectionLabel>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleRename(); }}
              style={{
                flex: 1, background: '#1a1a2a', border: '1px solid #2a2a3e',
                color: '#eee', borderRadius: 8, padding: '10px 14px', fontSize: 15,
                fontFamily: 'inherit',
              }}
            />
            <button
              onClick={handleRename}
              disabled={renameStatus === 'saving' || renameValue.trim() === session.name}
              style={{
                padding: '10px 18px', borderRadius: 8, border: 'none',
                background: renameStatus === 'saved' ? '#1a3a1a' :
                  renameValue.trim() !== session.name ? '#4a9eff' : '#1e1e30',
                color: renameStatus === 'saved' ? '#51cf66' :
                  renameValue.trim() !== session.name ? '#fff' : '#555',
                fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              {renameStatus === 'saved' ? '✓ Saved' : renameStatus === 'saving' ? '...' : 'Rename'}
            </button>
          </div>
      </div>
      <MemorySection cwd={session.cwd} />
      <McpSection />

      <div>
        <SectionLabel>Session Info</SectionLabel>
        <div style={{
          background: '#12121e', borderRadius: 8, border: '1px solid #1e1e30',
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '10px 14px', fontSize: 15, color: '#bbb',
            borderBottom: '1px solid #1a1a28',
            display: 'flex', gap: 8,
          }}>
            <span style={{ opacity: 0.5, fontWeight: 600 }}>ID</span>
            <span style={{ fontFamily: "'Courier New', monospace" }}>{session.id}</span>
          </div>
          {session.cwd && (
            <div style={{
              padding: '10px 14px', fontSize: 15, color: '#bbb',
              display: 'flex', gap: 8,
            }}>
              <span style={{ opacity: 0.5, fontWeight: 600 }}>CWD</span>
              <span style={{ fontFamily: "'Courier New', monospace", wordBreak: 'break-all' }}>
                {session.cwd}
              </span>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
