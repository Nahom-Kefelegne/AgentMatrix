'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';

interface PathPickerProps {
  onSelect: (path: string) => void;
}

function FolderBrowser({ value, onChange }: { value: string; onChange: (path: string) => void }) {
  const [dirs, setDirs] = useState<{ name: string; path: string }[]>([]);
  const [loading, setLoading] = useState(false);

  const loadDirs = useCallback(async (parentPath: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/dirs?path=${encodeURIComponent(parentPath)}`);
      const data = await res.json();
      setDirs(data.dirs || []);
    } catch { setDirs([]); }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadDirs(value);
  }, [value, loadDirs]);

  return (
    <div style={{
      background: '#0e0e1a',
      border: '1px solid #2a2a3a',
      borderRadius: 8,
      overflow: 'hidden',
    }}>
      {/* Current path display */}
      <div style={{
        padding: '10px 14px',
        borderBottom: '1px solid #1a1a2e',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <span style={{
          fontSize: 13,
          color: '#4a9eff',
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
        }}>
          {value}
        </span>
      </div>

      {/* Directory list */}
      <div style={{ maxHeight: 280, overflowY: 'auto' }}>
        {/* Parent directory */}
        {value !== '/' && !/^[A-Za-z]:[\\\/]?$/.test(value) && (
          <div
            onClick={() => {
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
              onChange(parent);
            }}
            onMouseEnter={e => (e.currentTarget.style.background = '#1a1a2e')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            style={{
              padding: '8px 14px',
              fontSize: 14,
              color: '#7aafff',
              cursor: 'pointer',
              borderBottom: '1px solid #1a1a2e',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span style={{ fontSize: 12, opacity: 0.7 }}>{'\u2191'}</span> Parent Directory
          </div>
        )}

        {loading ? (
          <div style={{ padding: '16px', color: '#666', fontSize: 13, textAlign: 'center' }}>
            Loading...
          </div>
        ) : dirs.length === 0 ? (
          <div style={{ padding: '16px', color: '#555', fontSize: 13, textAlign: 'center' }}>
            No subdirectories
          </div>
        ) : (
          dirs.map(d => (
            <div
              key={d.path}
              onClick={() => onChange(d.path)}
              onMouseEnter={e => (e.currentTarget.style.background = '#1a1a2e')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              style={{
                padding: '8px 14px',
                fontSize: 14,
                color: '#d8d8e8',
                cursor: 'pointer',
                borderBottom: '1px solid rgba(26,26,46,0.5)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span style={{ fontSize: 12, color: '#888' }}>{'\u25B6'}</span>
              {d.name}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function PathPicker({ onSelect }: PathPickerProps) {
  const [currentPath, setCurrentPath] = useState('');
  const [sessionPaths, setSessionPaths] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const sysRes = await fetch('/api/system');
        const sysData = await sysRes.json();
        setCurrentPath(sysData.homedir || '/');
      } catch {
        setCurrentPath('/');
      }

      // Get active session CWDs as suggestions
      try {
        const res = await fetch('/api/sessions/active');
        const data = await res.json();
        const cwds: string[] = [];
        for (const s of data.sessions || []) {
          if (s.cwd && !cwds.includes(s.cwd)) cwds.push(s.cwd);
        }
        setSessionPaths(cwds);
      } catch {}
    })();
  }, []);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      background: '#0a0a14',
    }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2 }}
        style={{
          background: '#12121e',
          border: '1px solid #2a2a3a',
          borderRadius: 12,
          padding: 28,
          width: 520,
          maxHeight: '80vh',
          overflowY: 'auto',
          boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 700, color: '#e0e0e0', marginBottom: 4 }}>
          Open Folder
        </div>
        <div style={{ fontSize: 13, color: '#888', marginBottom: 20 }}>
          Browse to a project folder to open in the editor
        </div>

        {/* Folder browser */}
        <FolderBrowser value={currentPath} onChange={setCurrentPath} />

        {/* Open button */}
        <button
          onClick={() => onSelect(currentPath)}
          style={{
            width: '100%',
            padding: '10px 0',
            borderRadius: 6,
            border: 'none',
            background: '#4a9eff',
            color: '#fff',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
            marginTop: 16,
          }}
        >
          Open {currentPath.split('/').pop() || currentPath}
        </button>

        {/* Session CWDs as quick picks */}
        {sessionPaths.length > 0 && (
          <>
            <div style={{
              fontSize: 11,
              fontWeight: 700,
              color: '#888',
              textTransform: 'uppercase',
              letterSpacing: 1,
              marginTop: 20,
              marginBottom: 8,
            }}>
              Active Session Directories
            </div>
            {sessionPaths.map(p => (
              <div
                key={p}
                onClick={() => onSelect(p)}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                style={{
                  padding: '8px 12px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 13,
                  color: '#c8c8d8',
                  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {p}
              </div>
            ))}
          </>
        )}
      </motion.div>
    </div>
  );
}
