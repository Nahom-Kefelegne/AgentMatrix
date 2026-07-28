'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSocketContext } from './SocketProvider';
import { Modal, FormField, OptionGroup, OptionButton, TextArea, SelectInput } from './ui/Modal';
import type { CliType } from '@/lib/types';
import type { AppSettings } from '@/lib/state/appSettings';

interface CliHealthInfo {
  type: CliType;
  installed: boolean;
  version: string | null;
  binaryPath: string | null;
  error?: string;
}

interface AppSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onViewOrchestrator?: (sessionId: string) => void;
  dashboardV2Enabled: boolean;
  dashboardV2Override: boolean | null;
  onDashboardV2Change: (enabled: boolean) => void;
  onReplayIntro: () => void;
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

/** CLI icon metadata */
const CLI_ICON_META: Record<string, { svg: string; color: string; name: string }> = {
  claude: {
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 1L14.5 8L8 15L1.5 8L8 1Z" fill="currentColor" stroke="currentColor" stroke-width="0.5"/></svg>`,
    color: '#D97706',
    name: 'Claude Code',
  },
  copilot: {
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 1C8 1 6.5 4 4 5.5C1.5 7 1 8 1 8C1 8 3 8.5 4 10C5 11.5 5.5 15 5.5 15C5.5 15 7 11 8 9.5C9 11 10.5 15 10.5 15C10.5 15 11 11.5 12 10C13 8.5 15 8 15 8C15 8 14.5 7 12 5.5C9.5 4 8 1 8 1Z" fill="currentColor"/></svg>`,
    color: '#2F81F7',
    name: 'GitHub Copilot',
  },
};

export default function AppSettingsModal({
  isOpen,
  onClose,
  onViewOrchestrator,
  dashboardV2Enabled,
  dashboardV2Override,
  onDashboardV2Change,
  onReplayIntro,
}: AppSettingsModalProps) {
  const { socketRef, connected } = useSocketContext();
  const [settings, setSettings] = useState<AppSettings>({
    autoResume: true, defaultModel: '', defaultPermissionMode: 'bypassPermissions',
    defaultEffort: '', appendSystemPrompt: '',
  });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSaveSucceeded, setLastSaveSucceeded] = useState(false);
  const [orchestratorId, setOrchestratorId] = useState<string | null>(null);
  const [cliHealth, setCliHealth] = useState<CliHealthInfo[]>([]);
  const [healthLoading, setHealthLoading] = useState(false);
  const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const pendingSavesRef = useRef(0);

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

  // Fetch CLI health when modal opens
  useEffect(() => {
    if (isOpen) {
      fetchCliHealth();
    }
  }, [isOpen]);

  const [agencyHealth, setAgencyHealth] = useState<{ installed: boolean; version: string | null } | null>(null);

  const fetchCliHealth = useCallback(() => {
    setHealthLoading(true);
    fetch('/api/cli/health')
      .then(r => r.json())
      .then(data => {
        setCliHealth(data.clis || []);
        if (data.agency) setAgencyHealth(data.agency);
        setHealthLoading(false);
      })
      .catch(() => setHealthLoading(false));
  }, []);

  const save = useCallback((partial: Partial<AppSettings>) => {
    pendingSavesRef.current += 1;
    setSaving(true);
    const request = saveQueueRef.current.then(async () => {
      setSaveError(null);
      setLastSaveSucceeded(false);
      try {
        const response = await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(partial),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          setSaveError(typeof data?.error === 'string' ? data.error : 'Failed to save settings');
          return null;
        }
        setSettings(prev => ({ ...prev, ...(data as Partial<AppSettings> | null) }));
        setLastSaveSucceeded(true);
        return data as AppSettings;
      } catch (error) {
        console.error('[settings] Save failed:', error);
        setSaveError('Failed to save settings');
        return null;
      }
    });
    saveQueueRef.current = request.then(() => undefined, () => undefined);
    return request.finally(() => {
      pendingSavesRef.current -= 1;
      if (pendingSavesRef.current === 0) setSaving(false);
    });
  }, []);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Settings" maxWidth={520}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <span aria-live="polite" className={saveError ? 'subtle-text' : saving ? 'subtle-text' : 'muted-text'} style={{ fontSize: 13, color: saveError ? '#ff8787' : undefined }}>
            {saving ? 'Saving...' : saveError || (lastSaveSucceeded ? 'Auto-saved' : 'Changes auto-save')}
          </span>
        </div>
      }>

      {/* CLI Agents Section */}
      <div style={{ padding: '14px 0' }}>
        <div className="section-title">CLI Agents</div>
        <div className="section-desc">Detected CLI agents and their status.</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
          {(['claude', 'copilot'] as CliType[]).map(type => {
            const health = cliHealth.find(c => c.type === type);
            const installed = health?.installed ?? false;
            const isDefault = settings.defaultCli === type || (!settings.defaultCli && type === 'claude');
            const meta = CLI_ICON_META[type];

            return (
              <div key={type} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px', borderRadius: 8,
                background: 'rgba(255,255,255,0.03)',
                border: isDefault ? `1px solid ${meta.color}40` : '1px solid rgba(255,255,255,0.06)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span
                    style={{ color: installed ? meta.color : '#555', display: 'flex', alignItems: 'center' }}
                    dangerouslySetInnerHTML={{ __html: meta.svg }}
                  />
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: installed ? '#e5e5e5' : '#777' }}>
                      {meta.name}
                    </div>
                    <div style={{ fontSize: 12, color: '#888', fontFamily: 'monospace' }}>
                      {installed
                        ? `v${health?.version || '?'} - ${health?.binaryPath || 'on PATH'}`
                        : (health?.error || 'Not installed')}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {installed && (
                    <span style={{
                      fontSize: 11, color: '#34d399', fontWeight: 600,
                      padding: '2px 8px', borderRadius: 4,
                      background: 'rgba(52,211,153,0.1)',
                    }}>Ready</span>
                  )}
                  {!installed && (
                    <span style={{
                      fontSize: 11, color: '#666', fontWeight: 600,
                      padding: '2px 8px', borderRadius: 4,
                      background: 'rgba(255,255,255,0.03)',
                    }}>N/A</span>
                  )}
                  {installed && !isDefault && (
                    <button
                      className="btn-outline"
                      style={{ padding: '4px 10px', fontSize: 12 }}
                      onClick={() => save({ defaultCli: type })}
                    >
                      Set Default
                    </button>
                  )}
                  {isDefault && (
                    <span style={{
                      fontSize: 11, color: meta.color, fontWeight: 600,
                      padding: '2px 8px', borderRadius: 4,
                      background: `${meta.color}15`,
                    }}>Default</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
          <button
            className="btn-outline"
            style={{ padding: '6px 14px', fontSize: 13 }}
            disabled={healthLoading}
            onClick={fetchCliHealth}
          >
            {healthLoading ? 'Checking...' : 'Refresh Status'}
          </button>
        </div>

        {/* Agency toggle */}
        {agencyHealth?.installed && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 14px', borderRadius: 8, marginTop: 10,
            background: settings.useAgency ? 'rgba(99,102,241,0.08)' : 'rgba(255,255,255,0.03)',
            border: settings.useAgency ? '1px solid rgba(99,102,241,0.3)' : '1px solid rgba(255,255,255,0.06)',
          }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Microsoft Agency</div>
              <div style={{ fontSize: 12, color: '#888', fontFamily: 'monospace' }}>
                v{agencyHealth.version || '?'} — Launch CLIs via Agency platform
              </div>
            </div>
            <button
              className={`toggle-switch ${settings.useAgency ? 'toggle-switch--on' : 'toggle-switch--off'}`}
              onClick={() => save({ useAgency: !settings.useAgency })}
            />
          </div>
        )}
      </div>

      <hr className="divider" />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, padding: '14px 0' }}>
        <div style={{ flex: 1 }}>
          <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>Interface</span>
            <span className="subtle-text" style={{ fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase' }}>Preview</span>
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, marginTop: 6 }}>Control Center</div>
          <div className="section-desc" style={{ marginBottom: 0 }}>
            Use the console-first Control Center. Dashboard V1 remains available.
          </div>
          {dashboardV2Override !== null && (
            <div className="subtle-text" style={{ fontSize: 12, marginTop: 8 }}>
              URL override controls this run. This toggle can persist your preference, but the current display stays overridden.
            </div>
          )}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={dashboardV2Enabled}
          aria-label="Use Control Center"
          disabled={saving}
          className={`toggle-switch ${dashboardV2Enabled ? 'toggle-switch--on' : 'toggle-switch--off'}`}
          onClick={async () => {
            const next = !dashboardV2Enabled;
            const saved = await save({ dashboardV2: next });
            if (saved) onDashboardV2Change(next);
          }}
        >
          <div className="toggle-switch-knob" style={{ left: dashboardV2Enabled ? 25 : 3 }} />
        </button>
      </div>

      <hr className="divider" />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '14px 0' }}>
        <div style={{ flex: 1 }}>
          <div className="section-title">Welcome Briefing</div>
          <div className="section-desc" style={{ marginBottom: 0 }}>
            Replay the latest welcome and release briefing for Control Center, Context Canvas, rendered design docs, and session review.
          </div>
        </div>
        <button type="button" className="btn-outline" onClick={onReplayIntro}>
          Replay Welcome
        </button>
      </div>

      <hr className="divider" />

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
