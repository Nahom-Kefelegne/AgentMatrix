'use client';

import { useState, useEffect, useCallback } from 'react';
import type { SessionData, Action } from '@/lib/types';

const STATUS_COLORS: Record<string, string> = {
  idle: '#888888',
  working: '#51cf66',
  meeting: '#4a9eff',
};

function formatTimeAgo(timestamp?: number): string {
  if (!timestamp) return '';
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 14, fontWeight: 700, color: '#b0b0c8',
      textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8,
    }}>
      {children}
    </div>
  );
}

function CopyCliButton({ cwd, name }: { cwd?: string; name: string }) {
  const [copied, setCopied] = useState(false);
  const cmd = `cd ${cwd || '~'} && claude --dangerously-skip-permissions --resume ${name}`;
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(cmd);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      style={{
        width: '100%', padding: '10px 14px', borderRadius: 6,
        border: '1px solid #33334a', background: '#1e1e30',
        color: copied ? '#51cf66' : '#aaa', fontSize: 14, fontWeight: 600,
        cursor: 'pointer',
      }}
    >
      {copied ? 'Copied!' : 'Copy CLI Command'}
    </button>
  );
}

/** Restart dialog -- shows resume command */
function RestartDialog({ command, onClose }: { command: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200,
      }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 500, background: '#151520', border: '1px solid #2a2a3e', borderRadius: 12,
        zIndex: 201, padding: 20,
      }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#eee', marginBottom: 12 }}>
          Session Restarting
        </div>
        <div style={{ fontSize: 14, color: '#aaa', marginBottom: 12 }}>
          Session has been stopped. Run this command in your terminal to resume:
        </div>
        <div style={{
          background: '#12121e', borderRadius: 6, padding: '10px 14px',
          fontSize: 13, color: '#c8c8d8', fontFamily: "'Courier New', monospace",
          wordBreak: 'break-all', lineHeight: 1.5, marginBottom: 14,
        }}>
          {command}
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={() => {
            navigator.clipboard.writeText(command);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }} style={{
            padding: '8px 16px', borderRadius: 6, border: 'none',
            background: '#4a9eff', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}>
            {copied ? 'Copied!' : 'Copy Command'}
          </button>
          <button onClick={onClose} style={{
            padding: '8px 16px', borderRadius: 6, border: '1px solid #3a3a4e',
            background: '#1e1e30', color: '#aaa', fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}>
            Close
          </button>
        </div>
      </div>
    </>
  );
}

/** Memory notes section */
function MemorySection({ cwd }: { cwd?: string }) {
  const [notes, setNotes] = useState<{ filename: string; content: string }[]>([]);
  const [newNote, setNewNote] = useState('');
  const [adding, setAdding] = useState(false);
  const [showViewer, setShowViewer] = useState(false);

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
        body: JSON.stringify({
          cwd,
          filename: `note-${Date.now()}.md`,
          content: newNote.trim(),
        }),
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
        <button onClick={() => { loadNotes(); setShowViewer(true); }} style={{
          fontSize: 14, color: '#7aafff', background: 'none', border: 'none',
          cursor: 'pointer', fontWeight: 600,
        }}>
          View ({notes.length})
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <textarea
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleAdd())}
          placeholder="Add a memory note..."
          rows={3}
          style={{
            width: '100%', background: '#1e1e30', border: '1px solid #33334a',
            color: '#eee', borderRadius: 6, padding: '10px 12px', fontSize: 14,
            fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.5,
          }}
        />
        <button onClick={handleAdd} disabled={adding} style={{
          width: '100%', padding: '10px 14px', borderRadius: 6, border: 'none',
          background: '#4a9eff', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer',
          opacity: adding ? 0.6 : 1,
        }}>
          Add Note
        </button>
      </div>

      {showViewer && (
        <>
          <div onClick={() => setShowViewer(false)} style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200,
          }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            width: 560, maxHeight: '70vh', background: '#151520', border: '1px solid #2a2a3e',
            borderRadius: 12, zIndex: 201, display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}>
            <div style={{
              padding: '16px 20px', borderBottom: '1px solid #2a2a3e',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontSize: 18, fontWeight: 700, color: '#eee' }}>
                Memory Notes ({notes.length})
              </span>
              <button onClick={() => setShowViewer(false)} style={{
                width: 28, height: 28, borderRadius: 6, border: '1px solid #3a3a4e',
                background: '#1e1e30', color: '#aaa', fontSize: 14,
                display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
              }}>X</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px' }}>
              {notes.length === 0 ? (
                <div style={{ fontSize: 15, color: '#888', fontStyle: 'italic', padding: 16, textAlign: 'center' }}>
                  No memory notes yet
                </div>
              ) : notes.map((n, i) => (
                <div key={i} style={{
                  background: '#1e1e30', border: '1px solid #33334a', borderRadius: 8,
                  padding: '14px 16px', marginBottom: 10,
                }}>
                  <div style={{
                    fontSize: 13, color: '#999', marginBottom: 8, fontFamily: "'Courier New', monospace",
                  }}>
                    {n.filename}
                  </div>
                  <pre style={{
                    fontSize: 14, color: '#d8d8e8', margin: 0, whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word', fontFamily: "'Courier New', monospace", lineHeight: 1.6,
                  }}>
                    {n.content}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

interface McpRegistryItem {
  id: string; name: string; description: string; package: string;
  command: string; args: string[]; env?: Record<string, string>; category: string;
}

/** MCP servers section */
function McpSection() {
  const [installed, setInstalled] = useState<Record<string, unknown>>({});
  const [registry, setRegistry] = useState<McpRegistryItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showAvailable, setShowAvailable] = useState(false);
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
      const config: Record<string, unknown> = {
        command: server.command,
        args: server.args,
      };
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <SectionLabel>MCP Servers</SectionLabel>
        <button onClick={() => setShowAvailable(!showAvailable)} style={{
          fontSize: 14, color: '#7aafff', background: 'none', border: 'none',
          cursor: 'pointer', fontWeight: 600,
        }}>
          {showAvailable ? 'Hide Store' : '+ Add Server'}
        </button>
      </div>

      {installedNames.length > 0 && (
        <div style={{
          background: '#1a1a2a', borderRadius: 6, border: '1px solid #2a2a3e', marginBottom: 8,
        }}>
          {installedNames.map((name, i) => (
            <div key={name} style={{
              padding: '10px 14px', fontSize: 15, color: '#e0e0e8',
              borderBottom: i < installedNames.length - 1 ? '1px solid #222235' : 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%', background: '#51cf66',
                  display: 'inline-block',
                }} />
                {name}
              </div>
              <button onClick={() => handleRemove(name)} style={{
                fontSize: 13, color: '#ff6b6b', background: 'none', border: 'none',
                cursor: 'pointer',
              }}>
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {installedNames.length === 0 && !showAvailable && (
        <div style={{ fontSize: 14, color: '#777', fontStyle: 'italic', marginBottom: 8 }}>
          No servers installed
        </div>
      )}

      {showAvailable && (
        <div style={{
          background: '#1a1a2a', borderRadius: 6, border: '1px solid #2a2a3e',
          maxHeight: 250, overflowY: 'auto',
        }}>
          {availableServers.length === 0 ? (
            <div style={{ padding: '10px 14px', fontSize: 14, color: '#777', fontStyle: 'italic' }}>
              All servers installed
            </div>
          ) : availableServers.map((server, i) => (
            <div key={server.id} style={{
              padding: '10px 12px',
              borderBottom: i < availableServers.length - 1 ? '1px solid #222235' : 'none',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 15, fontWeight: 600, color: '#eee' }}>{server.name}</span>
                <button
                  onClick={() => handleInstall(server)}
                  disabled={installing === server.id}
                  style={{
                    fontSize: 12, padding: '3px 10px', borderRadius: 4, border: 'none',
                    background: '#4a9eff', color: '#fff', fontWeight: 600, cursor: 'pointer',
                    opacity: installing === server.id ? 0.5 : 1,
                  }}
                >
                  {installing === server.id ? '...' : 'Install'}
                </button>
              </div>
              <div style={{ fontSize: 13, color: '#aaa', marginTop: 3 }}>{server.description}</div>
              {server.env && Object.keys(server.env).length > 0 && (
                <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
                  Requires: {Object.keys(server.env).join(', ')}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={{ fontSize: 13, color: '#777', marginTop: 8, fontStyle: 'italic' }}>
        Restart session after changes
      </div>
    </div>
  );
}

// ===== Main SessionDialog component =====

interface SessionDialogProps {
  sessionId: string | null;
  sessions: Map<string, SessionData>;
  onClose: () => void;
  isTaskTracker: boolean;
  onSetTaskTracker: (sessionId: string) => void;
}

export default function SessionDialog({
  sessionId,
  sessions,
  onClose,
  isTaskTracker,
  onSetTaskTracker,
}: SessionDialogProps) {
  const [activeTab, setActiveTab] = useState<'info' | 'settings'>('info');
  const [killing, setKilling] = useState(false);
  const [restartCommand, setRestartCommand] = useState<string | null>(null);

  // Reset tab when session changes
  useEffect(() => { setActiveTab('info'); }, [sessionId]);

  if (!sessionId) return null;

  const session = sessions.get(sessionId);
  if (!session) return null;

  const statusColor = STATUS_COLORS[session.status] || STATUS_COLORS.idle;

  const handleKill = async () => {
    if (!confirm(`Fire "${session.name}"? They'll pack a box and leave.`)) return;
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
    if (!confirm(`Restart "${session.name}"? Session will be killed and you'll get a resume command.`)) return;
    try {
      const res = await fetch('/api/sessions/restart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.id }),
      });
      const data = await res.json();
      if (data.command) {
        setRestartCommand(data.command);
      }
    } catch (err) {
      console.error('Failed to restart:', err);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100,
        }}
      />

      {/* Dialog */}
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: '90vw', maxWidth: 800, maxHeight: '85vh',
        background: '#151520', border: '1px solid #2a2a3e', borderRadius: 14,
        zIndex: 101, display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '18px 24px', borderBottom: '1px solid #2a2a3e',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{
              width: 14, height: 14, borderRadius: '50%',
              backgroundColor: statusColor, display: 'inline-block',
              border: '2px solid rgba(255,255,255,0.15)',
            }} />
            <span style={{ fontSize: 22, fontWeight: 700, color: '#eee' }}>
              {session.name}
            </span>
            <span style={{
              fontSize: 13, fontWeight: 600, color: statusColor,
              textTransform: 'uppercase', marginLeft: 4,
            }}>
              {session.status}
            </span>
          </div>
          <button onClick={onClose} style={{
            width: 32, height: 32, borderRadius: 8, border: '1px solid #3a3a4e',
            background: '#1e1e30', color: '#aaa', fontSize: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          }}>X</button>
        </div>

        {/* Tabs */}
        <div style={{
          display: 'flex', borderBottom: '1px solid #2a2a3e', flexShrink: 0,
        }}>
          {(['info', 'settings'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{
              flex: 1, padding: '12px 0', fontSize: 15, fontWeight: 600, cursor: 'pointer',
              color: activeTab === tab ? '#eee' : '#666',
              background: 'none',
              borderTop: 'none', borderLeft: 'none', borderRight: 'none',
              borderBottomWidth: 2, borderBottomStyle: 'solid',
              borderBottomColor: activeTab === tab ? '#4a9eff' : 'transparent',
            }}>
              {tab === 'info' ? 'Info' : 'Settings'}
            </button>
          ))}
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          {activeTab === 'info' && (
            <InfoTab session={session} />
          )}
          {activeTab === 'settings' && (
            <SettingsTab session={session} />
          )}
        </div>

        {/* Bottom action bar */}
        <div style={{
          padding: '16px 24px', borderTop: '1px solid #2a2a3e',
          display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
        }}>
          <button onClick={() => onSetTaskTracker(session.id)} style={{
            padding: '10px 18px', borderRadius: 6,
            border: isTaskTracker ? '1px solid #4a9eff' : '1px solid #3a3a4e',
            background: isTaskTracker ? '#1a3a6a' : '#1e1e30',
            color: isTaskTracker ? '#7aafff' : '#aaa',
            fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}>
            {isTaskTracker ? 'Task Tracker' : 'Set as Task Tracker'}
          </button>
          <div style={{ flex: 1 }} />
          <button onClick={handleRestart} style={{
            padding: '10px 18px', borderRadius: 6,
            border: '1px solid #51cf66', background: '#152015',
            color: '#7adf7a', fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}>
            Restart
          </button>
          <button onClick={handleKill} disabled={killing} style={{
            padding: '10px 18px', borderRadius: 6,
            border: '1px solid #ff6b6b', background: '#2a1515',
            color: '#ff6b6b', fontSize: 14, fontWeight: 600,
            cursor: killing ? 'not-allowed' : 'pointer', opacity: killing ? 0.5 : 1,
          }}>
            {killing ? 'Firing...' : 'Fire'}
          </button>
        </div>
      </div>

      {/* Restart command dialog */}
      {restartCommand && (
        <RestartDialog command={restartCommand} onClose={() => setRestartCommand(null)} />
      )}
    </>
  );
}

// ===== Info Tab =====

function InfoTab({ session }: { session: SessionData }) {
  return (
    <>
      {/* Working Directory */}
      {session.cwd && (
        <div style={{ marginBottom: 20 }}>
          <SectionLabel>Working Directory</SectionLabel>
          <div style={{
            fontSize: 14, color: '#d0d0e0', padding: '8px 12px',
            background: '#1e1e30', border: '1px solid #33334a', borderRadius: 6,
            fontFamily: "'Courier New', monospace",
            wordBreak: 'break-all', overflowWrap: 'break-word',
          }}>
            {session.cwd}
          </div>
        </div>
      )}

      {/* Copy CLI command */}
      <div style={{ marginBottom: 20 }}>
        <CopyCliButton cwd={session.cwd} name={session.name} />
      </div>

      {/* Status */}
      <div style={{ marginBottom: 20 }}>
        <SectionLabel>Status</SectionLabel>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            display: 'inline-block', padding: '5px 14px', borderRadius: 4,
            fontSize: 14, fontWeight: 600,
            backgroundColor: STATUS_COLORS[session.status] || STATUS_COLORS.idle,
            color: '#fff', textTransform: 'uppercase',
          }}>
            {session.status}
          </span>
          {session.lastActivity && (
            <span style={{ fontSize: 14, color: '#aaa' }}>
              {formatTimeAgo(session.lastActivity)}
            </span>
          )}
        </div>
      </div>

      {/* Current Tool */}
      {session.currentTool && (
        <div style={{ marginBottom: 20 }}>
          <SectionLabel>Current Tool</SectionLabel>
          <div style={{ fontSize: 15, color: '#7aafff', fontWeight: 600 }}>
            {session.currentTool}
          </div>
        </div>
      )}

      {/* Tool Summary */}
      {session.lastToolSummary && (
        <div style={{ marginBottom: 20 }}>
          <SectionLabel>Working On</SectionLabel>
          <div style={{
            fontSize: 14, color: '#c8c8d8', padding: '8px 12px',
            background: '#1a1a2a', borderRadius: 6, border: '1px solid #2a2a3e',
            fontFamily: "'Courier New', monospace",
            wordBreak: 'break-all', overflowWrap: 'break-word',
          }}>
            {session.lastToolSummary}
          </div>
        </div>
      )}

      {/* Agent Team */}
      {session.agents && session.agents.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <SectionLabel>Agent Team{session.teamId ? ` - ${session.teamId}` : ''}</SectionLabel>
          <div style={{
            background: '#1a1a2a', borderRadius: 6, border: '1px solid #2a2a3e',
            overflow: 'hidden',
          }}>
            {session.agents.map((agent, i) => (
              <div key={agent.id} style={{
                padding: '9px 14px', fontSize: 14, color: '#c8c8d8',
                borderBottom: i < session.agents.length - 1 ? '1px solid #222235' : 'none',
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <span style={{
                  width: 10, height: 10, borderRadius: '50%',
                  backgroundColor: STATUS_COLORS[agent.status] || STATUS_COLORS.idle,
                  display: 'inline-block', flexShrink: 0,
                }} />
                <span style={{ fontWeight: 600, color: agent.color }}>{agent.name}</span>
                <span style={{ fontSize: 12, color: '#888', textTransform: 'uppercase' }}>
                  {agent.status}
                </span>
                {agent.currentTool && (
                  <span style={{ fontSize: 12, color: '#7aafff', marginLeft: 'auto' }}>
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
          <SectionLabel>Recent Actions</SectionLabel>
          <div style={{
            background: '#1a1a2a', borderRadius: 6, border: '1px solid #2a2a3e',
            overflow: 'hidden',
          }}>
            {session.recentActions.map((action: Action, i: number) => (
              <div key={i} style={{
                padding: '9px 14px', fontSize: 14, color: '#c8c8d8',
                borderBottom: i < session.recentActions.length - 1 ? '1px solid #222235' : 'none',
                fontFamily: "'Courier New', monospace",
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span style={{ color: '#888', fontSize: 13, flexShrink: 0 }}>{'>'}</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {action.summary || action.toolName}
                </span>
                {action.timestamp && (
                  <span style={{ fontSize: 12, color: '#666', flexShrink: 0 }}>
                    {formatTimeAgo(action.timestamp)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// ===== Settings Tab =====

function SettingsTab({ session }: { session: SessionData }) {
  return (
    <>
      <MemorySection cwd={session.cwd} />
      <McpSection />

      <div style={{ marginBottom: 20 }}>
        <SectionLabel>Session Info</SectionLabel>
        <div style={{
          background: '#1a1a2a', borderRadius: 6, border: '1px solid #2a2a3e',
          overflow: 'hidden',
        }}>
          <div style={{ padding: '10px 14px', fontSize: 14, color: '#b0b0c0', borderBottom: '1px solid #222235' }}>
            <span style={{ color: '#888' }}>ID: </span>{session.id.slice(0, 12)}...
          </div>
          {session.cwd && (
            <div style={{ padding: '10px 14px', fontSize: 14, color: '#b0b0c0' }}>
              <span style={{ color: '#888' }}>CWD: </span>
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
