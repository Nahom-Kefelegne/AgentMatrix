'use client';

import { useState, useEffect, useCallback } from 'react';

interface AppSettings {
  autoResume: boolean;
  defaultModel: string;
  defaultPermissionMode: string;
  defaultEffort: string;
  appendSystemPrompt: string;
}

interface AppSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const MODELS = [
  { value: '', label: 'Default (configured)' },
  { value: 'opus', label: 'Opus (Latest)' },
  { value: 'sonnet', label: 'Sonnet (Latest)' },
  { value: 'haiku', label: 'Haiku (Latest)' },
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
];

const PERMISSION_MODES = [
  { value: 'default', label: 'Default', desc: 'Ask for each tool use' },
  { value: 'bypassPermissions', label: 'Skip Permissions', desc: 'Auto-approve everything' },
  { value: 'acceptEdits', label: 'Accept Edits', desc: 'Auto-approve edits, ask for others' },
  { value: 'plan', label: 'Plan', desc: 'Plan only, no execution' },
  { value: 'auto', label: 'Auto', desc: 'Let Claude decide' },
];

const EFFORT_LEVELS = [
  { value: '', label: 'Default' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

export default function AppSettingsModal({ isOpen, onClose }: AppSettingsModalProps) {
  const [settings, setSettings] = useState<AppSettings>({
    autoResume: true, defaultModel: '', defaultPermissionMode: 'bypassPermissions',
    defaultEffort: '', appendSystemPrompt: '',
  });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen && !loaded) {
      fetch('/api/settings')
        .then(r => r.json())
        .then(data => { setSettings(data); setLoaded(true); })
        .catch(() => setLoaded(true));
    }
  }, [isOpen, loaded]);

  const save = useCallback(async (partial: Partial<AppSettings>) => {
    const updated = { ...settings, ...partial };
    setSettings(updated);
    setSaving(true);
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(partial),
    }).catch(() => {});
    setSaving(false);
  }, [settings]);

  if (!isOpen) return null;

  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 58,
      }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 520, maxHeight: '85vh', background: '#111118', border: '1px solid #222235',
        borderRadius: 14, zIndex: 59, display: 'flex', flexDirection: 'column',
        overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      }}>
        <div style={{
          padding: '20px 24px', borderBottom: '1px solid #1e1e30',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 20, fontWeight: 700, color: '#eee' }}>Settings</span>
          <button onClick={onClose} style={{
            width: 36, height: 36, borderRadius: 8, border: '1px solid #3a3a4e',
            background: '#1e1e30', color: '#ccc', fontSize: 18,
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          {/* Auto Resume */}
          <ToggleSetting
            label="Auto-resume sessions"
            description="Resume all active sessions when the app starts."
            checked={settings.autoResume}
            onChange={() => save({ autoResume: !settings.autoResume })}
          />

          <Divider />

          {/* Default Model */}
          <SelectSetting
            label="Default model"
            description="Model used for new sessions unless overridden."
            value={settings.defaultModel}
            options={MODELS}
            onChange={(v) => save({ defaultModel: v })}
          />

          <Divider />

          {/* Default Permission Mode */}
          <div style={{ padding: '14px 0' }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#eee', marginBottom: 4 }}>
              Default permission mode
            </div>
            <div style={{ fontSize: 14, color: '#888', marginBottom: 10 }}>
              Permission mode for new sessions.
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {PERMISSION_MODES.map(pm => (
                <button
                  key={pm.value}
                  onClick={() => save({ defaultPermissionMode: pm.value })}
                  title={pm.desc}
                  style={{
                    padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600,
                    border: settings.defaultPermissionMode === pm.value ? '1px solid #4a9eff' : '1px solid #2a2a3e',
                    background: settings.defaultPermissionMode === pm.value ? '#152540' : '#1a1a2a',
                    color: settings.defaultPermissionMode === pm.value ? '#7aafff' : '#888',
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  {pm.label}
                </button>
              ))}
            </div>
          </div>

          <Divider />

          {/* Default Effort */}
          <div style={{ padding: '14px 0' }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#eee', marginBottom: 4 }}>
              Default effort level
            </div>
            <div style={{ fontSize: 14, color: '#888', marginBottom: 10 }}>
              Effort level for new sessions.
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {EFFORT_LEVELS.map(e => (
                <button
                  key={e.value}
                  onClick={() => save({ defaultEffort: e.value })}
                  style={{
                    padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600,
                    border: settings.defaultEffort === e.value ? '1px solid #4a9eff' : '1px solid #2a2a3e',
                    background: settings.defaultEffort === e.value ? '#152540' : '#1a1a2a',
                    color: settings.defaultEffort === e.value ? '#7aafff' : '#888',
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  {e.label}
                </button>
              ))}
            </div>
          </div>

          <Divider />

          {/* Append System Prompt */}
          <div style={{ padding: '14px 0' }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#eee', marginBottom: 4 }}>
              Append to system prompt
            </div>
            <div style={{ fontSize: 14, color: '#888', marginBottom: 10 }}>
              Additional instructions appended to Claude&apos;s default system prompt for all new sessions.
            </div>
            <textarea
              value={settings.appendSystemPrompt}
              onChange={e => setSettings({ ...settings, appendSystemPrompt: e.target.value })}
              onBlur={() => save({ appendSystemPrompt: settings.appendSystemPrompt })}
              placeholder="e.g. Always write tests. Use TypeScript. Follow our team conventions..."
              rows={4}
              style={{
                width: '100%', background: '#1a1a2a', border: '1px solid #2a2a3e',
                color: '#eee', borderRadius: 8, padding: '10px 14px', fontSize: 14,
                fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.5,
              }}
            />
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 24px', borderTop: '1px solid #1e1e30',
          background: '#0e0e16', flexShrink: 0,
          display: 'flex', justifyContent: 'flex-end',
        }}>
          <span style={{ fontSize: 13, color: saving ? '#4a9eff' : '#555' }}>
            {saving ? 'Saving...' : 'Auto-saved'}
          </span>
        </div>
      </div>
    </>
  );
}

function ToggleSetting({ label, description, checked, onChange }: {
  label: string; description: string; checked: boolean; onChange: () => void;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      padding: '14px 0', gap: 16,
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: '#eee', marginBottom: 4 }}>{label}</div>
        <div style={{ fontSize: 14, color: '#888', lineHeight: 1.5 }}>{description}</div>
      </div>
      <button onClick={onChange} style={{
        width: 48, height: 26, borderRadius: 13, border: 'none',
        background: checked ? '#4a9eff' : '#2a2a3e',
        position: 'relative', cursor: 'pointer', flexShrink: 0,
        transition: 'background 0.2s', marginTop: 2,
      }}>
        <div style={{
          width: 20, height: 20, borderRadius: '50%', background: '#fff',
          position: 'absolute', top: 3,
          left: checked ? 25 : 3, transition: 'left 0.2s',
        }} />
      </button>
    </div>
  );
}

function SelectSetting({ label, description, value, options, onChange }: {
  label: string; description: string; value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div style={{ padding: '14px 0' }}>
      <div style={{ fontSize: 16, fontWeight: 600, color: '#eee', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 14, color: '#888', marginBottom: 10 }}>{description}</div>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '100%', background: '#1a1a2a', border: '1px solid #2a2a3e',
          color: '#eee', borderRadius: 8, padding: '10px 14px', fontSize: 15,
          fontFamily: 'inherit',
        }}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function Divider() {
  return <div style={{ borderBottom: '1px solid #1e1e30' }} />;
}
