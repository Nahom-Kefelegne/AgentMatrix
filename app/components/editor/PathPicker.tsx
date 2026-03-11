'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';

interface PathPickerProps {
  onSelect: (path: string) => void;
}

export default function PathPicker({ onSelect }: PathPickerProps) {
  const [manualPath, setManualPath] = useState('');
  const [recentPaths, setRecentPaths] = useState<string[]>([]);
  const [error, setError] = useState('');

  // Fetch recent paths from active sessions
  useEffect(() => {
    (async () => {
      try {
        // Try to get system default CWD
        const sysRes = await fetch('/api/system');
        const sysData = await sysRes.json();
        const defaultCwd = sysData.cwd || sysData.defaultCwd;

        // Try to get active sessions for their CWDs
        const paths: string[] = [];
        if (defaultCwd) paths.push(defaultCwd);

        // Also try home dir
        const home = defaultCwd?.split('/').slice(0, 3).join('/') || '/Users';
        if (home && !paths.includes(home)) paths.push(home);

        setRecentPaths(paths);
        if (defaultCwd) setManualPath(defaultCwd);
      } catch {
        setManualPath('/');
      }
    })();
  }, []);

  const handleSubmit = useCallback(async () => {
    const p = manualPath.trim();
    if (!p) return;

    // Validate path exists
    try {
      const res = await fetch(`/api/editor?action=tree&path=${encodeURIComponent(p)}`);
      const data = await res.json();
      if (data.error) {
        setError(`Cannot open: ${data.error}`);
        return;
      }
      setError('');
      onSelect(p);
    } catch {
      setError('Failed to access path');
    }
  }, [manualPath, onSelect]);

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
          padding: 32,
          width: 480,
          boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 700, color: '#e0e0e0', marginBottom: 4 }}>
          Open Folder
        </div>
        <div style={{ fontSize: 13, color: '#888', marginBottom: 24 }}>
          Choose a folder to open in the editor
        </div>

        {/* Manual path input */}
        <div style={{ marginBottom: 16 }}>
          <input
            value={manualPath}
            onChange={e => { setManualPath(e.target.value); setError(''); }}
            onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
            placeholder="/path/to/project"
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: 6,
              border: '1px solid #2a2a3a',
              background: '#0e0e1a',
              color: '#e0e0e0',
              fontSize: 14,
              outline: 'none',
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              boxSizing: 'border-box',
            }}
          />
          {error && (
            <div style={{ fontSize: 12, color: '#ff6b6b', marginTop: 6 }}>{error}</div>
          )}
        </div>

        <button
          onClick={handleSubmit}
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
            marginBottom: 20,
          }}
        >
          Open Folder
        </button>

        {/* Recent paths */}
        {recentPaths.length > 0 && (
          <>
            <div style={{
              fontSize: 11,
              fontWeight: 700,
              color: '#888',
              textTransform: 'uppercase',
              letterSpacing: 1,
              marginBottom: 8,
            }}>
              Suggested Paths
            </div>
            {recentPaths.map(p => (
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
