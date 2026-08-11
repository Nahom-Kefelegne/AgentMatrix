'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  RefreshCw,
  RotateCcw,
  Settings,
} from 'lucide-react';
import type { AppSettings } from '@/lib/state/appSettings';
import type { CliType } from '@/lib/types';
import {
  COPILOT_MODES,
  EFFORT_LEVELS,
  defaultPermissionModeForCli,
  modelsForCli,
  permissionModesForCli,
  validOptionValue,
} from '@/lib/cli/uiMetadata';
import CliIcon, { CLI_ICON_META } from './CliIcon';
import {
  FormField,
  Modal,
  OptionButton,
  OptionGroup,
  SelectInput,
  TextArea,
} from './ui/Modal';

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
  dashboardV2Enabled: boolean;
  dashboardV2Override: boolean | null;
  onDashboardV2Change: (enabled: boolean) => void;
  onReplayIntro: () => void;
}

const INITIAL_SETTINGS: AppSettings = {
  autoResume: true,
  defaultModel: '',
  defaultPermissionMode: 'bypassPermissions',
  defaultEffort: '',
  defaultCopilotMode: 'interactive',
  appendSystemPrompt: '',
};

export default function AppSettingsModal({
  isOpen,
  onClose,
  dashboardV2Enabled,
  dashboardV2Override,
  onDashboardV2Change,
  onReplayIntro,
}: AppSettingsModalProps) {
  const [settings, setSettings] = useState<AppSettings>(INITIAL_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSaveSucceeded, setLastSaveSucceeded] = useState(false);
  const [cliHealth, setCliHealth] = useState<CliHealthInfo[]>([]);
  const [agencyHealth, setAgencyHealth] = useState<{ installed: boolean; version: string | null } | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const pendingSavesRef = useRef(0);

  const fetchCliHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      const response = await fetch('/api/cli/health');
      const data = await response.json();
      setCliHealth(data.clis || []);
      setAgencyHealth(data.agency || null);
    } finally {
      setHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    Promise.all([
      fetch('/api/settings').then(response => response.json()),
      fetch('/api/cli/health').then(response => response.json()),
    ])
      .then(([savedSettings, health]) => {
        if (cancelled) return;
        setSettings({ ...INITIAL_SETTINGS, ...savedSettings });
        setCliHealth(health.clis || []);
        setAgencyHealth(health.agency || null);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

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
          setSaveError(typeof data?.error === 'string' ? data.error : 'Failed to save settings.');
          return null;
        }
        setSettings(previous => ({ ...previous, ...(data as Partial<AppSettings>) }));
        setLastSaveSucceeded(true);
        return data as AppSettings;
      } catch {
        setSaveError('Failed to save settings.');
        return null;
      }
    });
    saveQueueRef.current = request.then(() => undefined, () => undefined);
    return request.finally(() => {
      pendingSavesRef.current -= 1;
      if (pendingSavesRef.current === 0) setSaving(false);
    });
  }, []);

  const agencyEnabled = Boolean(settings.useAgency && agencyHealth?.installed);
  const providerAvailable = (type: CliType) => (
    cliHealth.some(item => item.type === type && item.installed) || agencyEnabled
  );
  const effectiveDefaultCli: CliType = settings.defaultCli && providerAvailable(settings.defaultCli)
    ? settings.defaultCli
    : providerAvailable('copilot')
      ? 'copilot'
      : 'claude';
  const modelOptions = modelsForCli(effectiveDefaultCli);
  const permissionOptions = permissionModesForCli(effectiveDefaultCli);
  const selectedModel = validOptionValue(modelOptions, settings.defaultModel);
  const selectedPermission = validOptionValue(
    permissionOptions,
    settings.defaultPermissionMode,
    defaultPermissionModeForCli(effectiveDefaultCli),
  );
  const selectedEffort = validOptionValue(EFFORT_LEVELS, settings.defaultEffort);
  const selectedCopilotMode = validOptionValue(
    COPILOT_MODES,
    settings.defaultCopilotMode,
    'interactive',
  );

  const selectDefaultCli = (type: CliType) => {
    if (!providerAvailable(type)) return;
    void save({
      defaultCli: type,
      defaultModel: '',
      defaultPermissionMode: defaultPermissionModeForCli(type),
      defaultEffort: '',
      defaultCopilotMode: 'interactive',
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Settings"
      eyebrow="Control Center"
      description="Configure provider defaults and AgentMatrix behavior. Session-specific launch profiles remain attached to each session."
      icon={<Settings size={16} />}
      maxWidth={760}
      footer={(
        <div className="cc-modal-footer-row">
          <span className={`cc-settings-save-state ${saveError ? 'cc-settings-save-state--error' : ''}`} aria-live="polite">
            {saving ? 'Saving changes…' : saveError || (lastSaveSucceeded ? 'Changes saved' : 'Changes auto-save')}
          </span>
          <button type="button" className="btn-outline" onClick={onClose}>Done</button>
        </div>
      )}
    >
      {!loaded ? <div className="cc-modal-empty" role="status">Loading settings…</div> : (
        <>
          <section className="cc-settings-section">
            <div className="cc-settings-section-heading">
              <span>Providers</span>
              <strong>Default CLI</strong>
              <p>New Session starts with this provider. You can override it per launch.</p>
            </div>
            <div className="cc-settings-provider-grid">
              {(['copilot', 'claude'] as CliType[]).map(type => {
                const health = cliHealth.find(item => item.type === type);
                const direct = Boolean(health?.installed);
                const available = direct || agencyEnabled;
                const selected = effectiveDefaultCli === type;
                return (
                  <button
                    key={type}
                    type="button"
                    className={`cc-settings-provider ${selected ? 'cc-settings-provider--selected' : ''}`}
                    onClick={() => selectDefaultCli(type)}
                    disabled={!available}
                    aria-pressed={selected}
                  >
                    <span className="cc-settings-provider-icon"><CliIcon cliType={type} /></span>
                    <span className="cc-settings-provider-copy">
                      <strong>{CLI_ICON_META[type].name}</strong>
                      <small>
                        {direct
                          ? health?.version || 'Installed'
                          : agencyEnabled
                            ? 'Available through Agency'
                            : health?.error || 'Not installed'}
                      </small>
                    </span>
                    <span className="cc-settings-provider-state">
                      {selected ? 'Default' : available ? 'Available' : 'Unavailable'}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="cc-settings-inline-actions">
              <button type="button" className="btn-outline" onClick={() => void fetchCliHealth()} disabled={healthLoading}>
                <RefreshCw size={13} aria-hidden="true" />
                {healthLoading ? 'Checking…' : 'Refresh provider status'}
              </button>
            </div>
            {agencyHealth?.installed ? (
              <button
                type="button"
                role="switch"
                aria-checked={Boolean(settings.useAgency)}
                className={`cc-inline-setting ${settings.useAgency ? 'cc-inline-setting--active' : ''}`}
                onClick={() => void save({ useAgency: !settings.useAgency })}
              >
                <span className="cc-inline-setting-indicator" aria-hidden="true" />
                <span>
                  <strong>Launch sessions through Microsoft Agency</strong>
                  <small>{agencyHealth.version ? `Agency ${agencyHealth.version}` : 'Agency detected'}</small>
                </span>
                <span className="cc-inline-setting-state">{settings.useAgency ? 'On' : 'Off'}</span>
              </button>
            ) : null}
          </section>

          <section className="cc-settings-section">
            <div className="cc-settings-section-heading">
              <span>Launch Profile</span>
              <strong>{CLI_ICON_META[effectiveDefaultCli].name} defaults</strong>
              <p>Only options supported by the selected provider are shown.</p>
            </div>
            <FormField label="Model" description="Passed directly to the provider when starting a new session.">
              <SelectInput
                name="default-model"
                value={selectedModel}
                onChange={value => void save({ defaultCli: effectiveDefaultCli, defaultModel: value })}
                options={modelOptions}
              />
            </FormField>
            {effectiveDefaultCli === 'copilot' ? (
              <FormField label="Agent mode">
                <OptionGroup>
                  {COPILOT_MODES.map(mode => (
                    <OptionButton
                      key={mode.value}
                      selected={selectedCopilotMode === mode.value}
                      onClick={() => void save({
                        defaultCli: effectiveDefaultCli,
                        defaultCopilotMode: mode.value as AppSettings['defaultCopilotMode'],
                      })}
                      description={mode.desc}
                    >
                      {mode.label}
                    </OptionButton>
                  ))}
                </OptionGroup>
              </FormField>
            ) : null}
            <FormField label={effectiveDefaultCli === 'copilot' ? 'Permissions' : 'Permission mode'}>
              <OptionGroup>
                {permissionOptions.map(mode => (
                  <OptionButton
                    key={mode.value}
                    selected={selectedPermission === mode.value}
                    onClick={() => void save({
                      defaultCli: effectiveDefaultCli,
                      defaultPermissionMode: mode.value,
                    })}
                    description={mode.desc}
                  >
                    {mode.label}
                  </OptionButton>
                ))}
              </OptionGroup>
            </FormField>
            <FormField label={effectiveDefaultCli === 'copilot' ? 'Reasoning effort' : 'Effort level'}>
              <OptionGroup>
                {EFFORT_LEVELS.map(level => (
                  <OptionButton
                    key={level.value}
                    selected={selectedEffort === level.value}
                    onClick={() => void save({
                      defaultCli: effectiveDefaultCli,
                      defaultEffort: level.value,
                    })}
                  >
                    {level.label}
                  </OptionButton>
                ))}
              </OptionGroup>
            </FormField>
            {effectiveDefaultCli === 'claude' ? (
              <FormField
                label="Append system prompt"
                optional
                description="Claude-only instructions appended to each new Claude session."
              >
                <TextArea
                  name="default-append-system-prompt"
                  value={settings.appendSystemPrompt}
                  onChange={value => setSettings(previous => ({ ...previous, appendSystemPrompt: value }))}
                  placeholder="Always write tests. Use TypeScript…"
                  rows={4}
                />
                <button
                  type="button"
                  className="btn-outline cc-settings-field-action"
                  onClick={() => void save({ appendSystemPrompt: settings.appendSystemPrompt })}
                >
                  Save prompt
                </button>
              </FormField>
            ) : null}
          </section>

          <section className="cc-settings-section">
            <div className="cc-settings-section-heading">
              <span>Behavior</span>
              <strong>Application defaults</strong>
              <p>These settings affect AgentMatrix itself, not provider-owned conversations.</p>
            </div>
            <div className="cc-settings-row">
              <div>
                <strong>Auto-resume active sessions</strong>
                <p>Restore tracked sessions when AgentMatrix starts.</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={settings.autoResume}
                aria-label="Auto-resume active sessions"
                className={`cc-switch ${settings.autoResume ? 'cc-switch--on' : ''}`}
                onClick={() => void save({ autoResume: !settings.autoResume })}
              >
                <span />
              </button>
            </div>
            <div className="cc-settings-row">
              <div>
                <strong>Use Control Center</strong>
                <p>Keep the console-first Dashboard V2 as the main workspace.</p>
                {dashboardV2Override !== null ? <small>The URL override controls this run.</small> : null}
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={dashboardV2Enabled}
                aria-label="Use Control Center"
                disabled={saving}
                className={`cc-switch ${dashboardV2Enabled ? 'cc-switch--on' : ''}`}
                onClick={async () => {
                  const next = !dashboardV2Enabled;
                  const saved = await save({ dashboardV2: next });
                  if (saved) onDashboardV2Change(next);
                }}
              >
                <span />
              </button>
            </div>
            <div className="cc-settings-row">
              <div>
                <strong>Welcome and release briefing</strong>
                <p>Replay the current product overview without changing its one-time release acknowledgement.</p>
              </div>
              <button type="button" className="btn-outline" onClick={onReplayIntro}>
                <RotateCcw size={13} aria-hidden="true" />
                Replay
              </button>
            </div>
          </section>

        </>
      )}
    </Modal>
  );
}
