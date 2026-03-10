'use client';

import { useState, useEffect, useCallback } from 'react';
import type { SessionData, Action } from '@/lib/types';
import TerminalPanel from './TerminalPanel';
import HandoffModal from './HandoffModal';
import FullscreenTerminal from './FullscreenTerminal';
import ContextBar from './ContextBar';
import { useSocketContext } from './SocketProvider';
import { useSessionContext } from '@/lib/hooks/useSessionContext';

const STATUS_COLORS: Record<string, string> = {
  idle: '#888888',
  working: '#51cf66',
  meeting: '#4a9eff',
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
  return (
    <div style={{
      fontSize: 13, fontWeight: 700, color: '#999',
      textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 8,
    }}>
      {children}
    </div>
  );
}

function CopyButton({ text, label, successLabel }: { text: string; label: string; successLabel?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      style={{
        padding: '8px 14px', borderRadius: 6,
        border: '1px solid #2a2a3e',
        background: copied ? '#1a3a1a' : '#1a1a2a',
        color: copied ? '#51cf66' : '#bbb',
        fontSize: 14, fontWeight: 600,
        cursor: 'pointer', transition: 'all 0.15s',
        fontFamily: 'inherit',
      }}
    >
      {copied ? (successLabel || 'Copied!') : label}
    </button>
  );
}

function RestartDialog({ command, onClose }: { command: string; onClose: () => void }) {
  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200,
      }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 520, background: '#151520', border: '1px solid #2a2a3e', borderRadius: 12,
        zIndex: 201, padding: 24,
      }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#eee', marginBottom: 8 }}>
          Session Restarted
        </div>
        <div style={{ fontSize: 15, color: '#aaa', marginBottom: 14 }}>
          Paste this in your terminal to resume:
        </div>
        <div style={{
          background: '#0e0e18', borderRadius: 8, padding: '12px 14px',
          fontSize: 14, color: '#d0e0f0', fontFamily: "'Courier New', monospace",
          wordBreak: 'break-all', lineHeight: 1.6, marginBottom: 16,
          border: '1px solid #1a1a2e',
        }}>
          {command}
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <CopyButton text={command} label="Copy Command" />
          <button onClick={onClose} style={{
            padding: '8px 16px', borderRadius: 6, border: '1px solid #2a2a3e',
            background: '#1a1a2a', color: '#888', fontSize: 14, fontWeight: 600, cursor: 'pointer',
            fontFamily: 'inherit',
          }}>
            Close
          </button>
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
      const [mcpRes, regRes] = await Promise.all([
        fetch('/api/sessions/mcp'),
        fetch('/api/sessions/mcp/registry'),
      ]);
      const mcpData = await mcpRes.json();
      const regData = await regRes.json();
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
  const { socketRef, connected } = useSocketContext();
  const contextMap = useSessionContext(socketRef, connected);
  const [activeTab, setActiveTab] = useState<'console' | 'tasks' | 'info' | 'settings'>('console');
  const [killing, setKilling] = useState(false);
  const [restartCommand, setRestartCommand] = useState<string | null>(null);
  const [showHandoff, setShowHandoff] = useState(false);
  const [handoffActive, setHandoffActive] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [terminalFullscreen, setTerminalFullscreen] = useState(false);
  const isConsole = activeTab === 'console';
  const [, setTick] = useState(0);
  // Live timestamps
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setActiveTab('console');
    setShowHandoff(false);
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
    try {
      const res = await fetch('/api/sessions/restart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.id }),
      });
      const data = await res.json();
      if (data.command) setRestartCommand(data.command);
    } catch (err) {
      console.error('Failed to restart:', err);
    }
  };

  const cliCmd = `cd ${session.cwd || '~'} && claude --dangerously-skip-permissions --resume ${session.name}`;

  return (
    <>
      {/* Backdrop */}
      {!noBackdrop && (
        <div onClick={onClose} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 100,
          backdropFilter: 'blur(4px)',
        }} />
      )}

      {/* Dialog */}
      <div style={{
        position: 'fixed',
        top: fullscreen ? 0 : '50%',
        left: fullscreen ? 0 : '50%',
        transform: fullscreen ? 'none' : 'translate(-50%, -50%)',
        width: fullscreen ? '100vw' : isConsole ? 1100 : 900,
        height: fullscreen ? '100vh' : '85vh',
        transition: 'width 0.2s ease, height 0.2s ease',
        background: '#111118', border: '1px solid #222235', borderRadius: 16,
        zIndex: 101, display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 24px 16px', borderBottom: '1px solid #1e1e30',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 12, height: 12, borderRadius: '50%',
                backgroundColor: statusColor,
                boxShadow: isWorking ? `0 0 8px ${statusColor}60` : 'none',
              }} />
              <span style={{ fontSize: 22, fontWeight: 700, color: '#eee' }}>
                {session.name}
              </span>
              <span style={{
                fontSize: 12, fontWeight: 600, color: statusColor,
                textTransform: 'uppercase', letterSpacing: 0.5,
                padding: '2px 8px', borderRadius: 4,
                background: `${statusColor}15`,
              }}>
                {session.status}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {onPrev && onNext && sessionTotal !== undefined && sessionIndex !== undefined && (
                <>
                  <button onClick={(e) => { e.stopPropagation(); onPrev(); }} style={{
                    width: 36, height: 36, borderRadius: 8, border: '1px solid #3a3a4e',
                    background: '#1e1e30', color: '#ccc', fontSize: 20,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}>&#8249;</button>
                  <span style={{ fontSize: 14, color: '#aaa', minWidth: 55, textAlign: 'center', fontWeight: 600 }}>
                    {sessionIndex + 1} of {sessionTotal}
                  </span>
                  <button onClick={(e) => { e.stopPropagation(); onNext(); }} style={{
                    width: 36, height: 36, borderRadius: 8, border: '1px solid #3a3a4e',
                    background: '#1e1e30', color: '#ccc', fontSize: 20,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}>&#8250;</button>
                </>
              )}
            {isConsole && (
              <button onClick={() => setTerminalFullscreen(true)} title="Terminal fullscreen" style={{
                width: 36, height: 36, borderRadius: 8, border: '1px solid #3a3a4e',
                background: '#1e1e30', color: '#ccc', fontSize: 16,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', fontFamily: 'inherit',
              }}>&#9635;</button>
            )}
            <button onClick={() => setFullscreen(f => !f)} title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} style={{
              width: 36, height: 36, borderRadius: 8, border: '1px solid #3a3a4e',
              background: '#1e1e30', color: '#ccc', fontSize: 18,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', fontFamily: 'inherit',
            }}>
              {fullscreen ? '⊡' : '⊞'}
            </button>
            <button onClick={onClose} style={{
              width: 36, height: 36, borderRadius: 8, border: '1px solid #3a3a4e',
              background: '#1e1e30', color: '#ccc', fontSize: 18,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', fontFamily: 'inherit',
              transition: 'all 0.15s',
            }}>
              X
            </button>
            </div>
          </div>

          {/* Quick info row under name */}
          {session.cwd && (
            <div style={{
              fontSize: 14, color: '#888', marginTop: 6, marginLeft: 24,
              fontFamily: "'Courier New', monospace",
            }}>
              {session.cwd}
            </div>
          )}
        </div>

        {/* Tabs */}
        <div style={{
          display: 'flex', borderBottom: '1px solid #1e1e30', flexShrink: 0,
          padding: '0 24px',
        }}>
          {(['console', 'tasks', 'info', 'settings'] as const).map(tab => {
            const labels: Record<string, string> = { console: 'Console', tasks: 'Tasks', info: 'Info', settings: 'Settings' };
            return (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{
              padding: '12px 20px', fontSize: 16, fontWeight: 600, cursor: 'pointer',
              color: activeTab === tab ? '#eee' : '#777',
              background: 'none', border: 'none', fontFamily: 'inherit',
              borderBottom: `2px solid ${activeTab === tab ? '#4a9eff' : 'transparent'}`,
              transition: 'all 0.15s',
            }}>
              {labels[tab]}
            </button>
            );
          })}
        </div>

        {/* Content — all tabs stay mounted to preserve state */}
        <div style={{
          flex: 1, minHeight: 0, position: 'relative',
        }}>
          <div style={{
            position: 'absolute', inset: 0, padding: '12px 16px',
            display: activeTab === 'console' ? 'flex' : 'none',
            flexDirection: 'column',
          }}>
            <TerminalPanel sessionId={session.id} sessionName={session.name} cwd={session.cwd} visible={activeTab === 'console'} readOnly={readOnly} />
          </div>
          <div style={{
            position: 'absolute', inset: 0, padding: '20px 24px',
            overflowY: 'auto',
            display: activeTab === 'tasks' ? 'block' : 'none',
          }}>
            <TasksTab sessionId={session.id} socketRef={socketRef} onOpenTask={onOpenTask} onSwitchToConsole={() => setActiveTab('console')} />
          </div>
          <div style={{
            position: 'absolute', inset: 0, padding: '20px 24px',
            overflowY: 'auto',
            display: activeTab === 'info' ? 'block' : 'none',
          }}>
            <InfoTab session={session} cliCmd={cliCmd} contextUsage={sessionId ? contextMap[sessionId] ?? null : null} socketRef={socketRef} />
          </div>
          <div style={{
            position: 'absolute', inset: 0, padding: '20px 24px',
            overflowY: 'auto',
            display: activeTab === 'settings' ? 'block' : 'none',
          }}>
            <SettingsTab session={session} socketRef={socketRef} />
          </div>
        </div>

        {/* Bottom bar */}
        {readOnly ? (
          <div style={{
            padding: '10px 24px', borderTop: '1px solid #1e1e30',
            background: '#0e0e16', flexShrink: 0,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ fontSize: 12, color: '#555', fontStyle: 'italic' }}>Read-only view</span>
          </div>
        ) : null}
        <div style={{
          padding: '14px 24px', borderTop: readOnly ? 'none' : '1px solid #1e1e30',
          display: readOnly ? 'none' : 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
          background: '#0e0e16',
        }}>
          <CopyButton text={cliCmd} label="Copy Resume Command" successLabel="Copied!" />

          <button onClick={() => setShowHandoff(true)} style={{
            padding: '8px 16px', borderRadius: 6,
            border: handoffActive ? '1px solid #ffd43b40' : '1px solid #cc5de840',
            background: handoffActive ? '#1a1a0e' : '#1a0e1a',
            color: handoffActive ? '#ffd43b' : '#cc5de8',
            fontSize: 14, fontWeight: 600, cursor: 'pointer',
            fontFamily: 'inherit', transition: 'all 0.15s',
          }}>
            {handoffActive ? 'Transfer in Progress...' : 'Transfer Context'}
          </button>

          <div style={{ flex: 1 }} />

          <button onClick={handleRestart} style={{
            padding: '8px 16px', borderRadius: 6,
            border: '1px solid #51cf6640', background: '#0e1a0e',
            color: '#51cf66', fontSize: 14, fontWeight: 600, cursor: 'pointer',
            fontFamily: 'inherit', transition: 'all 0.15s',
          }}>
            Restart
          </button>
          <button
            disabled={killing}
            onClick={() => {
              if (!confirm(`End "${session.name}"?`)) return;
              setKilling(true);
              const socket = socketRef.current;
              if (socket) {
                socket.emit('terminal:end' as any, { sessionId: session.id });
              }
              setTimeout(() => {
                setKilling(false);
                onClose();
              }, 4500);
            }}
            style={{
              padding: '8px 16px', borderRadius: 6,
              border: '1px solid #ff6b6b40', background: '#1a0e0e',
              color: '#ff6b6b', fontSize: 14, fontWeight: 600,
              cursor: killing ? 'not-allowed' : 'pointer',
              opacity: killing ? 0.5 : 1,
              fontFamily: 'inherit', transition: 'all 0.15s',
            }}
          >
            {killing ? 'Ending...' : 'End Session'}
          </button>
        </div>
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
    </>
  );
}

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
    return <div style={{ color: '#888', fontSize: 15, padding: 20, textAlign: 'center' }}>Loading...</div>;
  }

  if (tasks.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 0', gap: 12 }}>
        <div style={{ fontSize: 16, color: '#666' }}>No tasks assigned to this session</div>
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
              {task.description && <div style={{ fontSize: 13, color: '#777', marginTop: 4, fontWeight: 500 }}>{(task.description as string).slice(0, 80)}</div>}
              <div style={{ display: 'flex', gap: 5, marginTop: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: (TASK_STATE_COLORS[state] || '#888') + '15', color: TASK_STATE_COLORS[state] || '#888', fontWeight: 700 }}>{state}</span>
                {task.adoId && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: '#4a9eff10', color: '#4a9eff', fontWeight: 700 }}>#{task.adoId as number}</span>}
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

function InfoTab({ session, cliCmd, contextUsage, socketRef }: { session: SessionData; cliCmd: string; contextUsage: number | null; socketRef: React.RefObject<any> }) {
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
          <div style={{ fontSize: 14, color: '#555', fontStyle: 'italic' }}>
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
    // Send /rename to PTY if managed
    const socket = socketRef.current;
    if (socket) {
      socket.emit('terminal:input' as any, {
        sessionId: session.id,
        data: `/rename ${newName}\r`,
      });
    }
    // Update cache
    await fetch('/api/sessions/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, name: newName }),
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
            <span style={{ color: '#888', fontWeight: 600 }}>ID</span>
            <span style={{ fontFamily: "'Courier New', monospace" }}>{session.id}</span>
          </div>
          {session.cwd && (
            <div style={{
              padding: '10px 14px', fontSize: 15, color: '#bbb',
              display: 'flex', gap: 8,
            }}>
              <span style={{ color: '#888', fontWeight: 600 }}>CWD</span>
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
