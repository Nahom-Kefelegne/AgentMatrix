'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSocketContext } from './SocketProvider';
import { Modal, FormField, OptionGroup, OptionButton, TextArea, SelectInput } from './ui/Modal';

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
  onViewOrchestrator?: (sessionId: string) => void;
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

export default function AppSettingsModal({ isOpen, onClose, onViewOrchestrator }: AppSettingsModalProps) {
  const { socketRef, connected } = useSocketContext();
  const [settings, setSettings] = useState<AppSettings>({
    autoResume: true, defaultModel: '', defaultPermissionMode: 'bypassPermissions',
    defaultEffort: '', appendSystemPrompt: '',
  });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [orchestratorId, setOrchestratorId] = useState<string | null>(null);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !connected) return;
    const handler = (data: { sessionId: string }) => setOrchestratorId(data.sessionId);
    socket.on('orchestrator:id' as any, handler);
    socket.emit('orchestrator:get-id' as any);
    return () => { socket.off('orchestrator:id' as any, handler); };
  }, [socketRef, connected]);

  useEffect(() => {
    if (isOpen && !loaded) {
      fetch('/api/settings').then(r => r.json())
        .then(data => { setSettings(data); setLoaded(true); })
        .catch(() => setLoaded(true));
    }
  }, [isOpen, loaded]);

  const save = useCallback(async (partial: Partial<AppSettings>) => {
    const updated = { ...settings, ...partial };
    setSettings(updated);
    setSaving(true);
    await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(partial) }).catch(() => {});
    setSaving(false);
  }, [settings]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Settings" maxWidth={520}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <span className={saving ? 'subtle-text' : 'muted-text'} style={{ fontSize: 13 }}>
            {saving ? 'Saving...' : 'Auto-saved'}
          </span>
        </div>
      }>

      {/* Auto Resume */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, padding: '14px 0' }}>
        <div style={{ flex: 1 }}>
          <div className="section-title">Auto-resume sessions</div>
          <div className="section-desc" style={{ marginBottom: 0 }}>Resume all active sessions when the app starts.</div>
        </div>
        <button className={`toggle-switch ${settings.autoResume ? 'toggle-switch--on' : 'toggle-switch--off'}`}
          onClick={() => save({ autoResume: !settings.autoResume })}>
          <div className="toggle-switch-knob" style={{ left: settings.autoResume ? 25 : 3 }} />
        </button>
      </div>

      <hr className="divider" />

      <FormField label="Default model">
        <div className="section-desc">Model used for new sessions unless overridden.</div>
        <SelectInput value={settings.defaultModel} onChange={v => save({ defaultModel: v })} options={MODELS} />
      </FormField>

      <hr className="divider" />

      <FormField label="Default permission mode">
        <div className="section-desc">Permission mode for new sessions.</div>
        <OptionGroup>
          {PERMISSION_MODES.map(pm => (
            <OptionButton key={pm.value} selected={settings.defaultPermissionMode === pm.value}
              onClick={() => save({ defaultPermissionMode: pm.value })} title={pm.desc}>{pm.label}</OptionButton>
          ))}
        </OptionGroup>
      </FormField>

      <hr className="divider" />

      <FormField label="Default effort level">
        <div className="section-desc">Effort level for new sessions.</div>
        <OptionGroup>
          {EFFORT_LEVELS.map(e => (
            <OptionButton key={e.value} selected={settings.defaultEffort === e.value}
              onClick={() => save({ defaultEffort: e.value })}>{e.label}</OptionButton>
          ))}
        </OptionGroup>
      </FormField>

      <hr className="divider" />

      <FormField label="Append to system prompt">
        <div className="section-desc">Additional instructions appended to Claude&apos;s default system prompt.</div>
        <TextArea value={settings.appendSystemPrompt}
          onChange={v => setSettings({ ...settings, appendSystemPrompt: v })}
          placeholder="e.g. Always write tests. Use TypeScript..." rows={4} />
        <div style={{ marginTop: 8 }}>
          <button className="btn-outline" style={{ padding: '6px 14px', fontSize: 13 }}
            onClick={() => save({ appendSystemPrompt: settings.appendSystemPrompt })}>Save prompt</button>
        </div>
      </FormField>

      <hr className="divider" />

      {/* Orchestrator */}
      <div style={{ padding: '14px 0' }}>
        <div className="section-title">Orchestrator Session</div>
        <div className="section-desc">Internal Claude session used for deep search and app tasks.</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-outline" style={{ padding: '6px 14px', fontSize: 13 }}
            disabled={!orchestratorId}
            onClick={() => { if (orchestratorId && onViewOrchestrator) { onClose(); onViewOrchestrator(orchestratorId); } }}>
            {orchestratorId ? 'View Orchestrator' : 'Not running'}
          </button>
          <button className="btn-destructive" style={{ padding: '6px 14px', fontSize: 13 }}
            disabled={!orchestratorId}
            onClick={() => { if (!confirm('Reset orchestrator? All context will be lost.')) return; socketRef.current?.emit('orchestrator:reset' as any); }}>
            Reset
          </button>
        </div>
        {orchestratorId && (
          <div className="subtle-text" style={{ fontSize: 12, marginTop: 6, fontFamily: 'monospace' }}>{orchestratorId.slice(0, 12)}...</div>
        )}
      </div>
    </Modal>
  );
}
