'use client';

import { useState, useEffect, useCallback } from 'react';

interface AppSettings {
  autoResume: boolean;
}

interface AppSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AppSettingsModal({ isOpen, onClose }: AppSettingsModalProps) {
  const [settings, setSettings] = useState<AppSettings>({ autoResume: true });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (isOpen && !loaded) {
      fetch('/api/settings')
        .then(r => r.json())
        .then(data => { setSettings(data); setLoaded(true); })
        .catch(() => setLoaded(true));
    }
  }, [isOpen, loaded]);

  const toggle = useCallback(async (key: keyof AppSettings) => {
    const updated = { ...settings, [key]: !settings[key] };
    setSettings(updated);
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: updated[key] }),
    });
  }, [settings]);

  if (!isOpen) return null;

  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 58,
      }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 480, background: '#111118', border: '1px solid #222235',
        borderRadius: 14, zIndex: 59, overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 24px', borderBottom: '1px solid #1e1e30',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ fontSize: 20, fontWeight: 700, color: '#eee' }}>Settings</span>
          <button onClick={onClose} style={{
            width: 36, height: 36, borderRadius: 8, border: '1px solid #3a3a4e',
            background: '#1e1e30', color: '#ccc', fontSize: 18,
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          }}>✕</button>
        </div>

        {/* Settings */}
        <div style={{ padding: '20px 24px' }}>
          <ToggleSetting
            label="Auto-resume sessions"
            description="When the app starts, automatically resume all sessions that were active when it was last closed."
            checked={settings.autoResume}
            onChange={() => toggle('autoResume')}
          />
        </div>
      </div>
    </>
  );
}

function ToggleSetting({ label, description, checked, onChange }: {
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      padding: '14px 0', gap: 16,
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: '#eee', marginBottom: 4 }}>
          {label}
        </div>
        <div style={{ fontSize: 14, color: '#888', lineHeight: 1.5 }}>
          {description}
        </div>
      </div>
      <button
        onClick={onChange}
        style={{
          width: 48, height: 26, borderRadius: 13, border: 'none',
          background: checked ? '#4a9eff' : '#2a2a3e',
          position: 'relative', cursor: 'pointer', flexShrink: 0,
          transition: 'background 0.2s',
          marginTop: 2,
        }}
      >
        <div style={{
          width: 20, height: 20, borderRadius: '50%',
          background: '#fff',
          position: 'absolute', top: 3,
          left: checked ? 25 : 3,
          transition: 'left 0.2s',
        }} />
      </button>
    </div>
  );
}
