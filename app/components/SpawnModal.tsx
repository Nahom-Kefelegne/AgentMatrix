'use client';

import { useState, useCallback, useEffect } from 'react';
import { useSocketContext } from './SocketProvider';

interface SpawnModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSessionSpawned?: (sessionId: string) => void;
}

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
          color: '#eee', borderRadius: 8, padding: '10px 14px', fontSize: 15,
          fontFamily: "'Courier New', monospace", cursor: 'pointer',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
        <span style={{ color: '#888', fontSize: 14 }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 110,
          background: '#1a1a2a', border: '1px solid #2a2a3e', borderRadius: 8,
          marginTop: 4, maxHeight: 220, overflowY: 'auto',
        }}>
          <div onClick={() => {
            const isWinRoot = /^[A-Za-z]:[\\\/]?$/.test(value);
            if (isWinRoot || value === '/' || value === '\\') return;
            const normalized = value.replace(/\\/g, '/');
            const parts = normalized.split('/').filter(Boolean);
            parts.pop();
            let parent: string;
            if (parts.length === 0) {
              parent = /^[A-Za-z]:/.test(normalized) ? normalized.slice(0, 2) + '\\' : '/';
            } else if (/^[A-Za-z]:$/.test(parts[0])) {
              parent = parts.join('\\') + '\\';
            } else {
              parent = '/' + parts.join('/');
            }
            onChange(parent); loadDirs(parent);
          }} style={{
            padding: '10px 14px', fontSize: 15, color: '#7aafff', cursor: 'pointer',
            borderBottom: '1px solid #222238',
          }}>
            ↑ Parent Directory
          </div>
          <div onClick={async () => {
            try {
              const res = await fetch('/api/dirs?drives=true');
              const data = await res.json();
              if (data.drives && data.dirs?.length) setDirs(data.dirs);
            } catch {}
          }} style={{
            padding: '10px 14px', fontSize: 15, color: '#ffd43b', cursor: 'pointer',
            borderBottom: '1px solid #222238',
          }}>
            💾 Switch Drive
          </div>
          {dirs.map(d => (
            <div key={d.path}
              onClick={() => { onChange(d.path); loadDirs(d.path); }}
              onDoubleClick={() => { onChange(d.path); setOpen(false); }}
              style={{
              padding: '10px 14px', fontSize: 15, color: '#d8d8e8', cursor: 'pointer',
              borderBottom: '1px solid #222238',
            }}
              onMouseEnter={e => e.currentTarget.style.background = '#222238'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              📁 {d.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const PERMISSION_MODES = [
  { value: 'default', label: 'Default', desc: 'Ask for each tool use' },
  { value: 'bypassPermissions', label: 'Skip Permissions', desc: 'Auto-approve everything (sandbox only)' },
  { value: 'acceptEdits', label: 'Accept Edits', desc: 'Auto-approve file edits, ask for others' },
  { value: 'plan', label: 'Plan Mode', desc: 'Plan only, no execution' },
  { value: 'auto', label: 'Auto', desc: 'Let Claude decide when to ask' },
];

const MODELS = [
  { value: 'opus', label: 'Opus (Latest)' },
  { value: 'sonnet', label: 'Sonnet (Latest)' },
  { value: 'haiku', label: 'Haiku (Latest)' },
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
];

const EFFORT_LEVELS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

export default function SpawnModal({ isOpen, onClose, onSessionSpawned }: SpawnModalProps) {
  const { socketRef } = useSocketContext();
  const [cwd, setCwd] = useState('');
  useEffect(() => {
    if (!cwd) fetch('/api/system').then(r => r.json()).then(d => setCwd(d.homedir || '')).catch(() => {});
  }, []);
  const [sessionName, setSessionName] = useState('');
  const [permissionMode, setPermissionMode] = useState('');
  const [model, setModel] = useState('');
  const [effort, setEffort] = useState('');
  const [allowedTools, setAllowedTools] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [defaultsLoaded, setDefaultsLoaded] = useState(false);

  // Load defaults from app settings
  useEffect(() => {
    if (isOpen && !defaultsLoaded) {
      fetch('/api/settings')
        .then(r => r.json())
        .then(data => {
          if (data.defaultModel && !model) setModel(data.defaultModel);
          if (data.defaultPermissionMode) setPermissionMode(data.defaultPermissionMode);
          if (data.defaultEffort && !effort) setEffort(data.defaultEffort);
          if (data.appendSystemPrompt && !systemPrompt) setSystemPrompt(data.appendSystemPrompt);
          setDefaultsLoaded(true);
        })
        .catch(() => setDefaultsLoaded(true));
    }
  }, [isOpen, defaultsLoaded]);

  const handleLaunch = useCallback(() => {
    const socket = socketRef.current;
    if (!socket) return;

    setLaunching(true);

    // Listen for the spawned response
    const handleSpawned = (data: { sessionId: string }) => {
      socket.off('terminal:spawned' as any, handleSpawned);
      setLaunching(false);
      onSessionSpawned?.(data.sessionId);
      onClose();
    };
    socket.on('terminal:spawned' as any, handleSpawned);

    socket.emit('terminal:new' as any, {
      cwd,
      name: sessionName.trim() || undefined,
      permissionMode,
      model: model || undefined,
      effort: effort || undefined,
      allowedTools: allowedTools.trim() || undefined,
      systemPrompt: systemPrompt.trim() || undefined,
    });

    // Timeout fallback
    setTimeout(() => {
      socket.off('terminal:spawned' as any, handleSpawned);
      setLaunching(false);
      onClose();
    }, 5000);
  }, [socketRef, cwd, sessionName, permissionMode, model, effort, allowedTools, systemPrompt, onClose, onSessionSpawned]);

  if (!isOpen) return null;

  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 58,
      }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 580, maxHeight: '85vh', background: '#111118', border: '1px solid #222235',
        borderRadius: 14, zIndex: 59, display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 24px', borderBottom: '1px solid #1e1e30',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ fontSize: 20, fontWeight: 700, color: '#eee' }}>New Session</span>
          <button onClick={onClose} style={{
            width: 32, height: 32, borderRadius: 8, border: '1px solid #2a2a3e',
            background: '#1a1a2a', color: '#888', fontSize: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          }}>✕</button>
        </div>

        {/* Form */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          {/* Working Directory */}
          <div style={{ marginBottom: 18 }}>
            <label style={{ fontSize: 14, color: '#aaa', fontWeight: 600, display: 'block', marginBottom: 6 }}>
              Working Directory
            </label>
            <FolderPicker value={cwd} onChange={setCwd} />
          </div>

          {/* Session Name */}
          <div style={{ marginBottom: 18 }}>
            <label style={{ fontSize: 14, color: '#aaa', fontWeight: 600, display: 'block', marginBottom: 6 }}>
              Session Name <span style={{ color: '#555', fontWeight: 400 }}>(optional)</span>
            </label>
            <input
              value={sessionName}
              onChange={e => setSessionName(e.target.value)}
              placeholder="my-session"
              style={{
                width: '100%', background: '#1a1a2a', border: '1px solid #2a2a3e',
                color: '#eee', borderRadius: 8, padding: '10px 14px', fontSize: 15,
                fontFamily: 'inherit',
              }}
            />
          </div>

          {/* Permission Mode */}
          <div style={{ marginBottom: 18 }}>
            <label style={{ fontSize: 14, color: '#aaa', fontWeight: 600, display: 'block', marginBottom: 6 }}>
              Permission Mode
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {PERMISSION_MODES.map(pm => (
                <button
                  key={pm.value}
                  onClick={() => setPermissionMode(pm.value)}
                  title={pm.desc}
                  style={{
                    padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600,
                    border: permissionMode === pm.value ? '1px solid #4a9eff' : '1px solid #2a2a3e',
                    background: permissionMode === pm.value ? '#152540' : '#1a1a2a',
                    color: permissionMode === pm.value ? '#7aafff' : '#888',
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  {pm.label}
                </button>
              ))}
            </div>
          </div>

          {/* Advanced toggle */}
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            style={{
              background: 'none', border: 'none', color: '#7aafff',
              fontSize: 14, fontWeight: 600, cursor: 'pointer',
              fontFamily: 'inherit', marginBottom: 14, padding: 0,
            }}
          >
            {showAdvanced ? '▼ Advanced Options' : '▶ Advanced Options'}
          </button>

          {showAdvanced && (
            <>
              {/* Model */}
              <div style={{ marginBottom: 18 }}>
                <label style={{ fontSize: 14, color: '#aaa', fontWeight: 600, display: 'block', marginBottom: 6 }}>
                  Model <span style={{ color: '#555', fontWeight: 400 }}>(default: your configured model)</span>
                </label>
                <select
                  value={model}
                  onChange={e => setModel(e.target.value)}
                  style={{
                    width: '100%', background: '#1a1a2a', border: '1px solid #2a2a3e',
                    color: '#eee', borderRadius: 8, padding: '10px 14px', fontSize: 15,
                    fontFamily: 'inherit',
                  }}
                >
                  <option value="">Default</option>
                  {MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>

              {/* Effort */}
              <div style={{ marginBottom: 18 }}>
                <label style={{ fontSize: 14, color: '#aaa', fontWeight: 600, display: 'block', marginBottom: 6 }}>
                  Effort Level
                </label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={() => setEffort('')}
                    style={{
                      padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600,
                      border: !effort ? '1px solid #4a9eff' : '1px solid #2a2a3e',
                      background: !effort ? '#152540' : '#1a1a2a',
                      color: !effort ? '#7aafff' : '#888',
                      cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >Default</button>
                  {EFFORT_LEVELS.map(e => (
                    <button
                      key={e.value}
                      onClick={() => setEffort(e.value)}
                      style={{
                        padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600,
                        border: effort === e.value ? '1px solid #4a9eff' : '1px solid #2a2a3e',
                        background: effort === e.value ? '#152540' : '#1a1a2a',
                        color: effort === e.value ? '#7aafff' : '#888',
                        cursor: 'pointer', fontFamily: 'inherit',
                      }}
                    >{e.label}</button>
                  ))}
                </div>
              </div>

              {/* Allowed Tools */}
              <div style={{ marginBottom: 18 }}>
                <label style={{ fontSize: 14, color: '#aaa', fontWeight: 600, display: 'block', marginBottom: 6 }}>
                  Allowed Tools <span style={{ color: '#555', fontWeight: 400 }}>(e.g. "Bash,Read,Edit")</span>
                </label>
                <input
                  value={allowedTools}
                  onChange={e => setAllowedTools(e.target.value)}
                  placeholder="Leave empty for all tools"
                  style={{
                    width: '100%', background: '#1a1a2a', border: '1px solid #2a2a3e',
                    color: '#eee', borderRadius: 8, padding: '10px 14px', fontSize: 15,
                    fontFamily: 'inherit',
                  }}
                />
              </div>

              {/* System Prompt */}
              <div style={{ marginBottom: 18 }}>
                <label style={{ fontSize: 14, color: '#aaa', fontWeight: 600, display: 'block', marginBottom: 6 }}>
                  Append System Prompt
                </label>
                <textarea
                  value={systemPrompt}
                  onChange={e => setSystemPrompt(e.target.value)}
                  placeholder="Additional instructions..."
                  rows={3}
                  style={{
                    width: '100%', background: '#1a1a2a', border: '1px solid #2a2a3e',
                    color: '#eee', borderRadius: 8, padding: '10px 14px', fontSize: 14,
                    fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.5,
                  }}
                />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '16px 24px', borderTop: '1px solid #1e1e30',
          display: 'flex', justifyContent: 'flex-end', gap: 10,
          background: '#0e0e16',
        }}>
          <button onClick={onClose} style={{
            padding: '10px 20px', borderRadius: 8, border: '1px solid #2a2a3e',
            background: '#1a1a2a', color: '#888', fontSize: 15, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>Cancel</button>
          <button onClick={handleLaunch} disabled={launching} style={{
            padding: '10px 24px', borderRadius: 8, border: 'none',
            background: launching ? '#333' : '#4a9eff',
            color: '#fff', fontSize: 15, fontWeight: 600,
            cursor: launching ? 'default' : 'pointer', fontFamily: 'inherit',
          }}>
            {launching ? 'Launching...' : 'Launch Session'}
          </button>
        </div>
      </div>
    </>
  );
}
