'use client';

import { useState, useEffect, useCallback } from 'react';
import type { CharacterData } from '@/lib/types';
import { STATUS_COLORS } from '@/lib/constants';

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
  const cmd = `cd ${cwd || '~'} && agency claude --dangerously-skip-permissions --resume ${name}`;
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
      {copied ? '✓ Copied!' : 'Copy Resume Command'}
    </button>
  );
}

interface SidePanelProps {
  character: CharacterData | null;
  onClose: () => void;
  isTaskTracker?: boolean;
  onSetTaskTracker?: (sessionId: string) => void;
  onPrev?: () => void;
  onNext?: () => void;
  sessionIndex?: number;
  sessionTotal?: number;
}

/** Restart dialog — shows resume command */
function RestartDialog({ command, onClose }: { command: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100,
      }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 500, background: '#151520', border: '1px solid #2a2a3e', borderRadius: 12,
        zIndex: 101, padding: 20,
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
            {copied ? '✓ Copied!' : 'Copy Command'}
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

  const [showViewer, setShowViewer] = useState(false);

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
        }}>
          Add Note
        </button>
      </div>

      {showViewer && (
        <>
          <div onClick={() => setShowViewer(false)} style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100,
          }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            width: 560, maxHeight: '70vh', background: '#151520', border: '1px solid #2a2a3e',
            borderRadius: 12, zIndex: 101, display: 'flex', flexDirection: 'column', overflow: 'hidden',
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
              }}>✕</button>
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

      {/* Installed servers */}
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

      {/* Available servers store */}
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

export default function SidePanel({ character, onClose, isTaskTracker, onSetTaskTracker, onPrev, onNext, sessionIndex, sessionTotal }: SidePanelProps) {
  const isOpen = character !== null;
  const [killing, setKilling] = useState(false);
  const [restartCommand, setRestartCommand] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'info' | 'settings'>('info');
  const [panelWidth, setPanelWidth] = useState(420);
  const [draggingEdge, setDraggingEdge] = useState(false);

  useEffect(() => {
    if (!draggingEdge) return;
    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = window.innerWidth - e.clientX;
      setPanelWidth(Math.max(300, Math.min(700, newWidth)));
    };
    const handleMouseUp = () => setDraggingEdge(false);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingEdge]);

  const handleKill = async () => {
    if (!character || !confirm(`Fire "${character.name}"? They'll pack a box and leave.`)) return;
    setKilling(true);
    try {
      await fetch('/api/sessions/kill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: character.id }),
      });
      onClose();
    } catch (err) {
      console.error('Failed to kill session:', err);
    } finally {
      setKilling(false);
    }
  };

  const handleRestart = async () => {
    if (!character || !confirm(`Restart "${character.name}"? Session will be killed and you'll get a resume command.`)) return;
    try {
      const res = await fetch('/api/sessions/restart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: character.id }),
      });
      const data = await res.json();
      if (data.command) {
        setRestartCommand(data.command);
      }
    } catch (err) {
      console.error('Failed to restart:', err);
    }
  };

  // Reset tab when character changes
  useEffect(() => { setActiveTab('info'); }, [character?.id]);

  const [sessionCwd, setSessionCwd] = useState<string | undefined>();
  useEffect(() => {
    if (!character) return;
    fetch(`/api/sessions/info?id=${encodeURIComponent(character.id)}`)
      .then(r => r.json())
      .then(data => { if (data.cwd) setSessionCwd(data.cwd); })
      .catch(() => {});
  }, [character?.id]);

  return (
    <>
      {isOpen && (
        <div onClick={onClose} style={{
          position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.4)', zIndex: 44,
        }} />
      )}
      <div style={{
        position: 'fixed', top: 0, right: 0, width: panelWidth, height: '100vh',
        background: '#151520', borderLeft: '1px solid #2a2a3e', zIndex: 45,
        transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
        transition: draggingEdge ? 'none' : 'transform 0.25s ease-in-out',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Resize handle */}
        <div
          onMouseDown={() => setDraggingEdge(true)}
          style={{
            position: 'absolute', top: 0, left: -3, width: 6, height: '100%',
            cursor: 'col-resize', zIndex: 46,
          }}
        />
        {character && (
          <>
            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '16px 20px', borderBottom: '1px solid #2a2a3e',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{
                  width: 12, height: 12, borderRadius: '50%',
                  backgroundColor: character.color, display: 'inline-block',
                  border: '2px solid rgba(255,255,255,0.15)',
                }} />
                <span style={{ fontSize: 18, fontWeight: 700, color: '#eee' }}>
                  {character.name}
                </span>
              </div>
              <button onClick={onClose} style={{
                width: 28, height: 28, borderRadius: 6, border: '1px solid #3a3a4e',
                background: '#1e1e30', color: '#aaa', fontSize: 14,
                display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
              }}>✕</button>
            </div>

            {/* Session navigator */}
            {sessionTotal !== undefined && sessionTotal > 1 && (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '6px 20px', borderBottom: '1px solid #2a2a3e', background: '#12121e',
              }}>
                <button onClick={onPrev} style={{
                  padding: '4px 10px', borderRadius: 4, border: '1px solid #3a3a4e',
                  background: '#1e1e30', color: '#aaa', fontSize: 16, cursor: 'pointer',
                  fontFamily: 'inherit',
                }}>
                  ←
                </button>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: '#eee' }}>
                    {character.name}
                  </span>
                  <span style={{ fontSize: 13, color: '#aaa' }}>
                    {(sessionIndex ?? 0) + 1} of {sessionTotal}
                  </span>
                </div>
                <button onClick={onNext} style={{
                  padding: '4px 10px', borderRadius: 4, border: '1px solid #3a3a4e',
                  background: '#1e1e30', color: '#aaa', fontSize: 16, cursor: 'pointer',
                  fontFamily: 'inherit',
                }}>
                  →
                </button>
              </div>
            )}

            {/* Tabs */}
            <div style={{
              display: 'flex', borderBottom: '1px solid #2a2a3e',
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

            {/* Body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
              {activeTab === 'info' && (
                <>
                  {/* Working Directory */}
                  {sessionCwd && (
                    <div style={{ marginBottom: 20 }}>
                      <SectionLabel>Working Directory</SectionLabel>
                      <div style={{
                        fontSize: 14, color: '#d0d0e0', padding: '8px 12px',
                        background: '#1e1e30', border: '1px solid #33334a', borderRadius: 6,
                        fontFamily: "'Courier New', monospace",
                        wordBreak: 'break-all', overflowWrap: 'break-word',
                      }}>
                        {sessionCwd}
                      </div>
                    </div>
                  )}

                  {/* Copy CLI command */}
                  <div style={{ marginBottom: 20 }}>
                    <CopyCliButton cwd={sessionCwd} name={character.name} />
                  </div>

                  {/* Status */}
                  <div style={{ marginBottom: 20 }}>
                    <SectionLabel>Status</SectionLabel>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{
                        display: 'inline-block', padding: '5px 14px', borderRadius: 4,
                        fontSize: 14, fontWeight: 600,
                        backgroundColor: STATUS_COLORS[character.status] || STATUS_COLORS.idle,
                        color: '#fff', textTransform: 'uppercase',
                      }}>
                        {character.status}
                      </span>
                      {character.lastActivity && (
                        <span style={{ fontSize: 14, color: '#aaa' }}>
                          {formatTimeAgo(character.lastActivity)}
                        </span>
                      )}
                    </div>
                  </div>

                  {character.currentTool && (
                    <div style={{ marginBottom: 20 }}>
                      <SectionLabel>Current Tool</SectionLabel>
                      <div style={{ fontSize: 15, color: '#7aafff', fontWeight: 600 }}>
                        {character.currentTool}
                      </div>
                    </div>
                  )}

                  {character.lastToolSummary && (
                    <div style={{ marginBottom: 20 }}>
                      <SectionLabel>Working On</SectionLabel>
                      <div style={{
                        fontSize: 14, color: '#c8c8d8', padding: '8px 12px',
                        background: '#1a1a2a', borderRadius: 6, border: '1px solid #2a2a3e',
                        fontFamily: "'Courier New', monospace",
                        wordBreak: 'break-all', overflowWrap: 'break-word',
                      }}>
                        {character.lastToolSummary}
                      </div>
                    </div>
                  )}

                  {character.teamId && (
                    <div style={{ marginBottom: 20 }}>
                      <SectionLabel>Team</SectionLabel>
                      <div style={{ fontSize: 14, color: '#c8c8d8' }}>{character.teamId}</div>
                    </div>
                  )}

                  {character.recentActions.length > 0 && (
                    <div style={{ marginBottom: 20 }}>
                      <SectionLabel>Recent Actions</SectionLabel>
                      <div style={{
                        background: '#1a1a2a', borderRadius: 6, border: '1px solid #2a2a3e',
                        overflow: 'hidden',
                      }}>
                        {character.recentActions.slice(0, 8).map((action, i) => (
                          <div key={i} style={{
                            padding: '9px 14px', fontSize: 14, color: '#c8c8d8',
                            borderBottom: i < Math.min(character.recentActions.length, 8) - 1
                              ? '1px solid #222235' : 'none',
                            fontFamily: "'Courier New', monospace",
                            display: 'flex', alignItems: 'center', gap: 8,
                          }}>
                            <span style={{ color: '#888', fontSize: 13 }}>{'>'}</span>
                            <span>{action.summary || action.toolName}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {activeTab === 'settings' && (
                <>
                  <MemorySection cwd={sessionCwd} />
                  <McpSection />

                  <div style={{ marginBottom: 20 }}>
                    <SectionLabel>Session Info</SectionLabel>
                    <div style={{
                      background: '#1a1a2a', borderRadius: 6, border: '1px solid #2a2a3e',
                      overflow: 'hidden',
                    }}>
                      <div style={{ padding: '10px 14px', fontSize: 14, color: '#b0b0c0', borderBottom: '1px solid #222235' }}>
                        <span style={{ color: '#888' }}>ID: </span>{character.id.slice(0, 12)}...
                      </div>
                      {character.isAgent && character.parentName && (
                        <div style={{ padding: '10px 14px', fontSize: 14, color: '#b0b0c0' }}>
                          <span style={{ color: '#888' }}>Parent: </span>{character.parentName}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Bottom actions */}
            <div style={{ padding: '16px 20px', borderTop: '1px solid #2a2a3e', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {onSetTaskTracker && (
                <button onClick={() => onSetTaskTracker(character.id)} style={{
                  width: '100%', padding: '10px 16px', borderRadius: 6,
                  border: isTaskTracker ? '1px solid #4a9eff' : '1px solid #3a3a4e',
                  background: isTaskTracker ? '#1a3a6a' : '#1e1e30',
                  color: isTaskTracker ? '#7aafff' : '#aaa',
                  fontSize: 14, fontWeight: 600, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}>
                  {isTaskTracker ? '✓ Task Tracker' : 'Set as Task Tracker'}
                </button>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={handleRestart} style={{
                  flex: 1, padding: '10px 16px', borderRadius: 6,
                  border: '1px solid #3a5a3a', background: '#152015',
                  color: '#7adf7a', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                }}>
                  Restart
                </button>
                <button onClick={handleKill} disabled={killing} style={{
                  flex: 1, padding: '10px 16px', borderRadius: 6,
                  border: '1px solid #5a2a2a', background: '#2a1515',
                  color: '#ff6b6b', fontSize: 14, fontWeight: 600,
                  cursor: killing ? 'not-allowed' : 'pointer', opacity: killing ? 0.5 : 1,
                }}>
                  {killing ? 'Firing...' : 'Fire'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {restartCommand && (
        <RestartDialog command={restartCommand} onClose={() => setRestartCommand(null)} />
      )}
    </>
  );
}
