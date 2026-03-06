'use client';

import { useState, useEffect, useCallback } from 'react';

interface SessionInfo {
  id: string;
  name: string;
  slug: string;
  lastModified: number;
  active: boolean;
}

interface ResumeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function FolderPicker({ value, onChange }: { value: string; onChange: (path: string) => void }) {
  const [dirs, setDirs] = useState<{ name: string; path: string }[]>([]);
  const [open, setOpen] = useState(false);

  const loadDirs = useCallback(async (parentPath: string) => {
    try {
      const res = await fetch(`/api/dirs?path=${encodeURIComponent(parentPath)}`);
      const data = await res.json();
      setDirs(data.dirs || []);
    } catch {
      setDirs([]);
    }
  }, []);

  useEffect(() => {
    if (open) loadDirs(value);
  }, [open, value, loadDirs]);

  const goUp = () => {
    const parent = value.split('/').slice(0, -1).join('/') || '/';
    onChange(parent);
    loadDirs(parent);
    // stay open to keep navigating
  };

  const selectFolder = (path: string) => {
    onChange(path);
    setOpen(false); // close after selecting
  };

  return (
    <div style={{ position: 'relative' }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          width: '100%', background: '#1e1e30', border: '1px solid #33334a',
          color: '#eee', borderRadius: 6, padding: '10px 14px', fontSize: 15,
          fontFamily: 'inherit', cursor: 'pointer', display: 'flex',
          justifyContent: 'space-between', alignItems: 'center',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
        <span style={{ color: '#aaa', fontSize: 14 }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 110,
          background: '#1e1e30', border: '1px solid #33334a', borderRadius: 6,
          marginTop: 4, maxHeight: 220, overflowY: 'auto',
        }}>
          <div onClick={goUp} style={{
            padding: '10px 14px', fontSize: 15, color: '#7aafff', cursor: 'pointer',
            borderBottom: '1px solid #2a2a3e', display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span>↑</span>
            <span>Parent Directory</span>
          </div>
          {dirs.map(d => (
            <div
              key={d.path}
              onClick={() => selectFolder(d.path)}
              style={{
                padding: '10px 14px', fontSize: 15, color: '#d8d8e8', cursor: 'pointer',
                borderBottom: '1px solid #2a2a3e',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#2a2a3e')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              📁 {d.name}
            </div>
          ))}
          {dirs.length === 0 && (
            <div style={{ padding: '10px 14px', fontSize: 14, color: '#777', fontStyle: 'italic' }}>
              No subdirectories
            </div>
          )}
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
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function ResumeModal({ isOpen, onClose }: ResumeModalProps) {
  const [cwd, setCwd] = useState('/Users/nkefelegne/Desktop/DEV');
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const loadSessions = useCallback(async (path: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/sessions/list?cwd=${encodeURIComponent(path)}`);
      const data = await res.json();
      setSessions(data.sessions || []);
    } catch {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) loadSessions(cwd);
  }, [isOpen, cwd, loadSessions]);

  const handleCwdChange = (path: string) => {
    setCwd(path);
    loadSessions(path);
  };

  const getCommand = (session: SessionInfo) => {
    return `cd ${cwd} && agency claude --dangerously-skip-permissions --resume ${session.name}`;
  };

  const handleCopy = (session: SessionInfo) => {
    navigator.clipboard.writeText(getCommand(session));
    setCopied(session.id);
    setTimeout(() => setCopied(null), 3000);
  };

  if (!isOpen) return null;

  const inactiveSessions = sessions.filter(s => !s.active);

  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 58,
      }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 620, maxHeight: '80vh', background: '#151520', border: '1px solid #2a2a3e',
        borderRadius: 12, zIndex: 59, display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '18px 24px', borderBottom: '1px solid #2a2a3e',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ fontSize: 20, fontWeight: 700, color: '#eee' }}>Resume Session</span>
          <button onClick={onClose} style={{
            width: 32, height: 32, borderRadius: 6, border: '1px solid #3a3a4e',
            background: '#1e1e30', color: '#aaa', fontSize: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          }}>✕</button>
        </div>

        {/* Path picker */}
        <div style={{ padding: '14px 24px', borderBottom: '1px solid #2a2a3e' }}>
          <label style={{ fontSize: 14, color: '#b0b0c8', fontWeight: 700, display: 'block', marginBottom: 8 }}>
            Project Directory
          </label>
          <FolderPicker value={cwd} onChange={handleCwdChange} />
        </div>

        {/* Session list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 24px' }}>
          {loading ? (
            <div style={{ color: '#aaa', fontSize: 15, padding: 20, textAlign: 'center' }}>Loading sessions...</div>
          ) : inactiveSessions.length === 0 ? (
            <div style={{ color: '#777', fontSize: 15, padding: 20, textAlign: 'center', fontStyle: 'italic' }}>
              No inactive sessions found for this path
            </div>
          ) : (
            inactiveSessions.map(s => (
              <div key={s.id} style={{
                background: '#1e1e30', border: '1px solid #33334a', borderRadius: 8,
                padding: '14px 16px', marginBottom: 10,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 17, fontWeight: 700, color: '#eee' }}>{s.name}</span>
                  <span style={{ fontSize: 14, color: '#aaa' }}>{formatTimeAgo(s.lastModified)}</span>
                </div>
                {s.slug && s.slug !== s.name && (
                  <div style={{ fontSize: 14, color: '#888', marginBottom: 8 }}>{s.slug}</div>
                )}
                {/* Command preview */}
                <div style={{
                  background: '#12121e', borderRadius: 6, padding: '8px 12px', marginBottom: 12,
                  fontSize: 13, color: '#b0b0c0', fontFamily: "'Courier New', monospace",
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {getCommand(s)}
                </div>
                <button
                  onClick={() => handleCopy(s)}
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: 6, border: 'none',
                    background: copied === s.id ? '#2a5a2a' : '#4a9eff',
                    color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  {copied === s.id ? '✓ Copied! Paste in terminal to resume' : 'Copy Resume Command'}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
