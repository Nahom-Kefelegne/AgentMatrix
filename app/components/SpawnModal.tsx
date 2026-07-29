'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Plus, ShieldCheck } from 'lucide-react';
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
import { useSocketContext } from './SocketProvider';
import { FolderPicker } from './ui/FolderPicker';
import {
  FormField,
  Modal,
  OptionButton,
  OptionGroup,
  SelectInput,
  TextArea,
  TextInput,
} from './ui/Modal';

interface CliHealthInfo {
  type: CliType;
  installed: boolean;
  version: string | null;
  binaryPath: string | null;
  error?: string;
}

interface SpawnModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSessionSpawned?: (sessionId: string) => void;
}

interface LaunchMetadata {
  settings: AppSettings;
  cliHealth: CliHealthInfo[];
  agencyAvailable: boolean;
  agencyVersion: string | null;
}

function isCliAvailable(
  type: CliType,
  health: CliHealthInfo[],
  useAgency: boolean,
  agencyAvailable: boolean,
): boolean {
  return health.some(item => item.type === type && item.installed)
    || (useAgency && agencyAvailable);
}

export default function SpawnModal({ isOpen, onClose, onSessionSpawned }: SpawnModalProps) {
  const { connected, socketRef } = useSocketContext();
  const [cwd, setCwd] = useState('');
  const [sessionName, setSessionName] = useState('');
  const [cliType, setCliType] = useState<CliType>('copilot');
  const [permissionMode, setPermissionMode] = useState('default');
  const [model, setModel] = useState('');
  const [effort, setEffort] = useState('');
  const [copilotMode, setCopilotMode] = useState('interactive');
  const [allowedTools, setAllowedTools] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [metadata, setMetadata] = useState<LaunchMetadata | null>(null);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [useAgency, setUseAgency] = useState(false);
  const launchCleanupRef = useRef<(() => void) | null>(null);

  const applyDefaults = useCallback((type: CliType, settings: AppSettings) => {
    const useStoredDefaults = settings.defaultCli === type;
    const models = modelsForCli(type);
    const permissions = permissionModesForCli(type);
    setModel(useStoredDefaults ? validOptionValue(models, settings.defaultModel) : '');
    setPermissionMode(
      useStoredDefaults
        ? validOptionValue(permissions, settings.defaultPermissionMode, defaultPermissionModeForCli(type))
        : defaultPermissionModeForCli(type),
    );
    setEffort(useStoredDefaults ? validOptionValue(EFFORT_LEVELS, settings.defaultEffort) : '');
    setCopilotMode(
      type === 'copilot' && useStoredDefaults
        ? validOptionValue(COPILOT_MODES, settings.defaultCopilotMode, 'interactive')
        : 'interactive',
    );
    setSystemPrompt(type === 'claude' ? settings.appendSystemPrompt || '' : '');
    setAllowedTools('');
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setMetadataLoading(true);
    setLaunchError('');
    setSessionName('');
    setNameTouched(false);
    setShowAdvanced(false);

    Promise.all([
      fetch('/api/system').then(response => response.json()),
      fetch('/api/cli/health').then(response => response.json()),
      fetch('/api/settings').then(response => response.json()),
    ])
      .then(([system, healthPayload, settings]) => {
        if (cancelled) return;
        const cliHealth = (healthPayload.clis || []) as CliHealthInfo[];
        const agencyAvailable = Boolean(healthPayload.agency?.installed);
        const agencyEnabled = Boolean(settings.useAgency && agencyAvailable);
        const configuredDefault = settings.defaultCli as CliType | undefined;
        const preferred: CliType = configuredDefault
          && isCliAvailable(configuredDefault, cliHealth, agencyEnabled, agencyAvailable)
          ? configuredDefault
          : isCliAvailable('copilot', cliHealth, agencyEnabled, agencyAvailable)
            ? 'copilot'
            : 'claude';
        const nextMetadata = {
          settings: settings as AppSettings,
          cliHealth,
          agencyAvailable,
          agencyVersion: healthPayload.agency?.version || null,
        };
        setMetadata(nextMetadata);
        setUseAgency(agencyEnabled);
        setCwd(system.homedir || '');
        setCliType(preferred);
        applyDefaults(preferred, nextMetadata.settings);
        setMetadataLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setMetadataLoading(false);
        setLaunchError('AgentMatrix could not load CLI launch settings.');
      });

    return () => {
      cancelled = true;
      launchCleanupRef.current?.();
      launchCleanupRef.current = null;
      setLaunching(false);
    };
  }, [applyDefaults, isOpen]);

  const selectCli = useCallback((type: CliType) => {
    if (!metadata || !isCliAvailable(type, metadata.cliHealth, useAgency, metadata.agencyAvailable)) return;
    setCliType(type);
    applyDefaults(type, metadata.settings);
  }, [applyDefaults, metadata, useAgency]);

  const toggleAgency = useCallback(() => {
    if (!metadata?.agencyAvailable) return;
    const next = !useAgency;
    setUseAgency(next);
    fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ useAgency: next }),
    }).catch(() => {});
  }, [metadata?.agencyAvailable, useAgency]);

  const handleLaunch = useCallback(() => {
    const socket = socketRef.current;
    const name = sessionName.trim();
    if (!name) {
      setNameTouched(true);
      return;
    }
    if (!connected || !socket?.connected) {
      setLaunchError('AgentMatrix is disconnected. Reconnect before starting a session.');
      return;
    }
    if (!cwd) {
      setLaunchError('Choose a working directory.');
      return;
    }

    setLaunching(true);
    setLaunchError('');
    launchCleanupRef.current?.();
    const cleanup = () => {
      socket.off('terminal:spawned' as any, handleSpawned);
      socket.off('terminal:spawn-error' as any, handleSpawnError);
      window.clearTimeout(timeout);
    };
    const handleSpawned = (data: { sessionId: string }) => {
      cleanup();
      launchCleanupRef.current = null;
      setLaunching(false);
      onSessionSpawned?.(data.sessionId);
      onClose();
    };
    const handleSpawnError = (data: { error?: string }) => {
      cleanup();
      launchCleanupRef.current = null;
      setLaunching(false);
      setLaunchError(data.error || 'The CLI process could not be started.');
    };
    const timeout = window.setTimeout(() => {
      cleanup();
      launchCleanupRef.current = null;
      setLaunching(false);
      setLaunchError('The session did not start within 20 seconds.');
    }, 20_000);
    launchCleanupRef.current = cleanup;

    socket.on('terminal:spawned' as any, handleSpawned);
    socket.on('terminal:spawn-error' as any, handleSpawnError);
    socket.emit('terminal:new' as any, {
      cwd,
      name,
      permissionMode,
      model: model || undefined,
      effort: effort || undefined,
      allowedTools: allowedTools.trim() || undefined,
      systemPrompt: cliType === 'claude' ? systemPrompt.trim() || undefined : undefined,
      cliType,
      copilotMode: cliType === 'copilot' ? copilotMode : undefined,
    });
  }, [
    allowedTools,
    cliType,
    connected,
    copilotMode,
    cwd,
    effort,
    model,
    onClose,
    onSessionSpawned,
    permissionMode,
    sessionName,
    socketRef,
    systemPrompt,
  ]);

  const models = modelsForCli(cliType);
  const permissionModes = permissionModesForCli(cliType);
  const nameValid = sessionName.trim().length > 0;
  const selectedCliAvailable = metadata
    ? isCliAvailable(cliType, metadata.cliHealth, useAgency, metadata.agencyAvailable)
    : false;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Start a Session"
      eyebrow="New Session"
      description="Launch a native CLI in the selected workspace. The terminal opens directly in Control Center."
      icon={<Plus size={16} />}
      maxWidth={700}
      closeDisabled={launching}
      footer={(
        <div className="cc-modal-footer-row">
          <span className="cc-modal-footer-status" role="status" aria-live="polite">
            {launching ? 'Waiting for CLI startup…' : launchError}
          </span>
          <button className="btn-outline" onClick={onClose} disabled={launching}>Cancel</button>
          <button
            className="btn-primary"
            onClick={handleLaunch}
            disabled={launching || metadataLoading || !nameValid || !selectedCliAvailable || !connected}
          >
            {launching ? 'Launching…' : 'Launch Session'}
          </button>
        </div>
      )}
    >
      <section className="cc-form-section">
        <div className="cc-form-section-heading">
          <span>01</span>
          <div>
            <strong>Choose the CLI</strong>
            <p>Only installed providers—or providers available through Agency—can be selected.</p>
          </div>
        </div>
        <OptionGroup>
          {(['copilot', 'claude'] as CliType[]).map(type => {
            const health = metadata?.cliHealth.find(item => item.type === type);
            const available = metadata
              ? isCliAvailable(type, metadata.cliHealth, useAgency, metadata.agencyAvailable)
              : false;
            return (
              <OptionButton
                key={type}
                selected={cliType === type}
                disabled={!available || metadataLoading}
                onClick={() => selectCli(type)}
                description={
                  health?.installed
                    ? health.version || 'Installed'
                    : useAgency && metadata?.agencyAvailable
                      ? 'Available through Agency'
                      : health?.error || 'Not installed'
                }
              >
                <span className="cc-cli-option">
                  <CliIcon cliType={type} />
                  {CLI_ICON_META[type].name}
                </span>
              </OptionButton>
            );
          })}
        </OptionGroup>

        {metadata?.agencyAvailable ? (
          <button
            type="button"
            role="switch"
            aria-checked={useAgency}
            className={`cc-inline-setting ${useAgency ? 'cc-inline-setting--active' : ''}`}
            onClick={toggleAgency}
          >
            <span className="cc-inline-setting-indicator" aria-hidden="true" />
            <span>
              <strong>Launch through Microsoft Agency</strong>
              <small>{metadata.agencyVersion ? `Agency ${metadata.agencyVersion}` : 'Agency detected'}</small>
            </span>
            <span className="cc-inline-setting-state">{useAgency ? 'On' : 'Off'}</span>
          </button>
        ) : null}
      </section>

      <section className="cc-form-section">
        <div className="cc-form-section-heading">
          <span>02</span>
          <div>
            <strong>Name and workspace</strong>
            <p>The name persists with the provider session and appears in the left session list.</p>
          </div>
        </div>
        <FormField label="Session name" required>
          <TextInput
            data-autofocus
            name="session-name"
            autoComplete="off"
            spellCheck={false}
            value={sessionName}
            onChange={setSessionName}
            onBlur={() => setNameTouched(true)}
            error={nameTouched && !nameValid}
            placeholder="auth-refresh"
          />
          {nameTouched && !nameValid ? <div className="error-text">Session name is required.</div> : null}
        </FormField>
        <FormField label="Working directory">
          <FolderPicker value={cwd} onChange={setCwd} />
        </FormField>
      </section>

      <section className="cc-form-section">
        <div className="cc-form-section-heading">
          <span>03</span>
          <div>
            <strong>Execution profile</strong>
            <p>These settings are preserved when AgentMatrix restarts or resumes this session.</p>
          </div>
        </div>
        {cliType === 'copilot' ? (
          <FormField label="Agent mode">
            <OptionGroup>
              {COPILOT_MODES.map(mode => (
                <OptionButton
                  key={mode.value}
                  selected={copilotMode === mode.value}
                  onClick={() => setCopilotMode(mode.value)}
                  description={mode.desc}
                >
                  {mode.label}
                </OptionButton>
              ))}
            </OptionGroup>
          </FormField>
        ) : null}
        <FormField label={cliType === 'copilot' ? 'Permissions' : 'Permission mode'}>
          <OptionGroup>
            {permissionModes.map(mode => (
              <OptionButton
                key={mode.value}
                selected={permissionMode === mode.value}
                onClick={() => setPermissionMode(mode.value)}
                description={mode.desc}
              >
                {mode.label}
              </OptionButton>
            ))}
          </OptionGroup>
        </FormField>
      </section>

      <button
        type="button"
        className="cc-advanced-toggle"
        aria-expanded={showAdvanced}
        onClick={() => setShowAdvanced(value => !value)}
      >
        <ChevronDown size={14} className={showAdvanced ? 'cc-advanced-toggle-icon--open' : ''} aria-hidden="true" />
        Advanced launch controls
      </button>

      {showAdvanced ? (
        <section className="cc-form-section cc-form-section--advanced">
          <FormField label="Model" description={`Model IDs are passed directly to ${CLI_ICON_META[cliType].name}.`}>
            <SelectInput name="launch-model" value={model} onChange={setModel} options={models} />
          </FormField>
          <FormField label={cliType === 'copilot' ? 'Reasoning effort' : 'Effort level'}>
            <OptionGroup>
              {EFFORT_LEVELS.map(level => (
                <OptionButton key={level.value} selected={effort === level.value} onClick={() => setEffort(level.value)}>
                  {level.label}
                </OptionButton>
              ))}
            </OptionGroup>
          </FormField>
          <FormField
            label={cliType === 'copilot' ? 'Allowed tool patterns' : 'Allowed tools'}
            optional
            description={cliType === 'copilot' ? 'Comma-separated Copilot allow-tool patterns.' : 'Comma-separated Claude tool names.'}
          >
            <TextInput
              name="allowed-tools"
              autoComplete="off"
              value={allowedTools}
              onChange={setAllowedTools}
              placeholder={cliType === 'copilot' ? 'shell(npm:*), write, url' : 'Bash, Read, Edit'}
            />
          </FormField>
          {cliType === 'claude' ? (
            <FormField label="Append system prompt" optional>
              <TextArea
                name="append-system-prompt"
                value={systemPrompt}
                onChange={setSystemPrompt}
                placeholder="Additional session instructions…"
              />
            </FormField>
          ) : null}
          <div className="cc-profile-note">
            <ShieldCheck size={14} aria-hidden="true" />
            <span>AgentMatrix stores this launch profile locally so restart and auto-resume retain it.</span>
          </div>
        </section>
      ) : null}
    </Modal>
  );
}
