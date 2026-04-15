'use client';

import { useState, useCallback, useEffect } from 'react';
import { useSocketContext } from './SocketProvider';
import { Modal, FormField, OptionGroup, OptionButton, TextInput, TextArea, SelectInput } from './ui/Modal';
import { FolderPicker } from './ui/FolderPicker';
import type { CliType } from '@/lib/types';

interface CliHealthInfo {
  type: CliType;
  installed: boolean;
  version: string | null;
  binaryPath: string | null;
  error?: string;
}

const PERMISSION_MODES = [
  { value: 'default', label: 'Default', desc: 'Ask for each tool use' },
  { value: 'bypassPermissions', label: 'Skip Permissions', desc: 'Auto-approve everything (sandbox only)' },
  { value: 'acceptEdits', label: 'Accept Edits', desc: 'Auto-approve file edits, ask for others' },
  { value: 'plan', label: 'Plan Mode', desc: 'Plan only, no execution' },
  { value: 'auto', label: 'Auto', desc: 'Let Claude decide when to ask' },
];

const CLAUDE_MODELS = [
  { value: '', label: 'Default' },
  { value: 'opus', label: 'Opus (Latest)' },
  { value: 'sonnet', label: 'Sonnet (Latest)' },
  { value: 'haiku', label: 'Haiku (Latest)' },
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
];

const COPILOT_MODELS = [
  { value: '', label: 'Default' },
  { value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
  { value: 'gpt-5', label: 'GPT-5' },
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { value: 'gemini-3-pro', label: 'Gemini 3 Pro' },
];

const EFFORT_LEVELS = [
  { value: '', label: 'Default' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

/** Inline SVG icons for CLI types */
const CLI_ICONS: Record<CliType, { svg: string; color: string; name: string }> = {
  claude: {
    svg: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 1L14.5 8L8 15L1.5 8L8 1Z" fill="currentColor" stroke="currentColor" stroke-width="0.5"/></svg>`,
    color: '#D97706',
    name: 'Claude Code',
  },
  copilot: {
    svg: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 1C8 1 6.5 4 4 5.5C1.5 7 1 8 1 8C1 8 3 8.5 4 10C5 11.5 5.5 15 5.5 15C5.5 15 7 11 8 9.5C9 11 10.5 15 10.5 15C10.5 15 11 11.5 12 10C13 8.5 15 8 15 8C15 8 14.5 7 12 5.5C9.5 4 8 1 8 1Z" fill="currentColor"/></svg>`,
    color: '#2F81F7',
    name: 'GitHub Copilot',
  },
};

interface SpawnModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSessionSpawned?: (sessionId: string) => void;
}

export default function SpawnModal({ isOpen, onClose, onSessionSpawned }: SpawnModalProps) {
  const { socketRef } = useSocketContext();
  const [cwd, setCwd] = useState('');
  const [sessionName, setSessionName] = useState('');
  const [permissionMode, setPermissionMode] = useState('');
  const [model, setModel] = useState('');
  const [effort, setEffort] = useState('');
  const [allowedTools, setAllowedTools] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [defaultsLoaded, setDefaultsLoaded] = useState(false);
  const [cliType, setCliType] = useState<CliType>('claude');
  const [cliHealth, setCliHealth] = useState<CliHealthInfo[]>([]);
  const [healthLoaded, setHealthLoaded] = useState(false);
  const [agencyAvailable, setAgencyAvailable] = useState(false);
  const [agencyVersion, setAgencyVersion] = useState<string | null>(null);
  const [useAgency, setUseAgency] = useState(false);

  useEffect(() => {
    if (!cwd) fetch('/api/system').then(r => r.json()).then(d => setCwd(d.homedir || '')).catch(() => {});
  }, []);

  // Fetch CLI health on mount
  useEffect(() => {
    if (isOpen && !healthLoaded) {
      fetch('/api/cli/health')
        .then(r => r.json())
        .then(data => {
          const clis: CliHealthInfo[] = data.clis || [];
          setCliHealth(clis);
          setHealthLoaded(true);
          if (data.agency?.installed) {
            setAgencyAvailable(true);
            setAgencyVersion(data.agency.version);
          }
          // Auto-select first installed CLI (or use default from settings)
          const installed = clis.filter(c => c.installed);
          if (installed.length > 0 && !installed.find(c => c.type === cliType)) {
            setCliType(installed[0].type);
          }
        })
        .catch(() => setHealthLoaded(true));
    }
  }, [isOpen, healthLoaded]);

  useEffect(() => {
    if (isOpen && !defaultsLoaded) {
      fetch('/api/settings').then(r => r.json()).then(data => {
        if (data.defaultModel && !model) setModel(data.defaultModel);
        if (data.defaultPermissionMode) setPermissionMode(data.defaultPermissionMode);
        if (data.defaultEffort && !effort) setEffort(data.defaultEffort);
        if (data.appendSystemPrompt && !systemPrompt) setSystemPrompt(data.appendSystemPrompt);
        if (data.defaultCli) setCliType(data.defaultCli);
        if (data.useAgency) setUseAgency(true);
        setDefaultsLoaded(true);
      }).catch(() => setDefaultsLoaded(true));
    }
  }, [isOpen, defaultsLoaded]);

  // Reset model when CLI type changes
  useEffect(() => {
    setModel('');
  }, [cliType]);

  const models = cliType === 'copilot' ? COPILOT_MODELS : CLAUDE_MODELS;

  const getCliHealthInfo = (type: CliType): CliHealthInfo | undefined => {
    return cliHealth.find(c => c.type === type);
  };

  const handleLaunch = useCallback(() => {
    const socket = socketRef.current;
    if (!socket) return;
    setLaunching(true);
    const handleSpawned = (data: { sessionId: string }) => {
      socket.off('terminal:spawned' as any, handleSpawned);
      setLaunching(false);
      onSessionSpawned?.(data.sessionId);
      onClose();
    };
    socket.on('terminal:spawned' as any, handleSpawned);
    socket.emit('terminal:new' as any, {
      cwd, name: sessionName.trim() || undefined, permissionMode,
      model: model || undefined, effort: effort || undefined,
      allowedTools: allowedTools.trim() || undefined,
      systemPrompt: systemPrompt.trim() || undefined,
      cliType,
    });
    setTimeout(() => { socket.off('terminal:spawned' as any, handleSpawned); setLaunching(false); onClose(); }, 5000);
  }, [socketRef, cwd, sessionName, permissionMode, model, effort, allowedTools, systemPrompt, cliType, onClose, onSessionSpawned]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="New Session"
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button className="btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleLaunch} disabled={launching}>
            {launching ? 'Launching...' : 'Launch Session'}
          </button>
        </div>
      }>

      {/* CLI Selector */}
      <FormField label="CLI">
        <OptionGroup>
          {(['claude', 'copilot'] as CliType[]).map(type => {
            const health = getCliHealthInfo(type);
            const installed = health?.installed ?? false;
            const icon = CLI_ICONS[type];
            return (
              <OptionButton
                key={type}
                selected={cliType === type}
                onClick={() => installed && setCliType(type)}
                title={!installed ? (health?.error || `${icon.name} not installed`) : icon.name}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: installed ? 1 : 0.4 }}>
                  <span
                    style={{ color: installed ? icon.color : '#666', display: 'flex', alignItems: 'center' }}
                    dangerouslySetInnerHTML={{ __html: icon.svg }}
                  />
                  <span>{icon.name}</span>
                </div>
                {healthLoaded && (
                  <div style={{
                    fontSize: 11, marginTop: 2,
                    color: installed ? '#888' : '#666',
                  }}>
                    {installed ? (health?.version || 'Installed') : 'Not installed'}
                  </div>
                )}
              </OptionButton>
            );
          })}
        </OptionGroup>
      </FormField>

      {/* Agency toggle — only show if Agency is detected */}
      {agencyAvailable && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 12px', borderRadius: 8, marginBottom: 16,
          background: useAgency ? 'var(--accent)' : 'var(--surface-1, #f5f5f5)',
          border: `1px solid ${useAgency ? 'var(--ring)' : 'var(--border)'}`,
          cursor: 'pointer', transition: 'all 0.15s',
        }} onClick={() => setUseAgency(!useAgency)}>
          <div style={{
            width: 32, height: 18, borderRadius: 9, padding: 2,
            background: useAgency ? 'var(--primary)' : 'var(--muted)',
            transition: 'background 0.2s',
          }}>
            <div style={{
              width: 14, height: 14, borderRadius: '50%', background: '#fff',
              transform: useAgency ? 'translateX(14px)' : 'translateX(0)',
              transition: 'transform 0.2s',
            }} />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Launch via Agency</div>
            <div style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>
              Microsoft Agent Platform {agencyVersion ? `v${agencyVersion}` : ''}
            </div>
          </div>
        </div>
      )}

      <FormField label="Working Directory">
        <FolderPicker value={cwd} onChange={setCwd} />
      </FormField>
      <FormField label="Session Name" optional>
        <TextInput value={sessionName} onChange={setSessionName} placeholder="my-session" />
      </FormField>
      <FormField label="Permission Mode">
        <OptionGroup>
          {PERMISSION_MODES.map(pm => (
            <OptionButton key={pm.value} selected={permissionMode === pm.value}
              onClick={() => setPermissionMode(pm.value)} title={pm.desc}>{pm.label}</OptionButton>
          ))}
        </OptionGroup>
      </FormField>

      <button onClick={() => setShowAdvanced(!showAdvanced)}
        style={{ fontSize: 14, fontWeight: 600, color: '#6366f1', cursor: 'pointer', marginBottom: 16,
          display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', fontFamily: 'inherit', padding: 0 }}>
        <span style={{ fontSize: 10 }}>{showAdvanced ? '▼' : '▶'}</span> Advanced Options
      </button>

      {showAdvanced && (
        <>
          <FormField label="Model"><SelectInput value={model} onChange={setModel} options={models} /></FormField>
          <FormField label="Effort Level">
            <OptionGroup>
              {EFFORT_LEVELS.map(e => (
                <OptionButton key={e.value} selected={effort === e.value} onClick={() => setEffort(e.value)}>{e.label}</OptionButton>
              ))}
            </OptionGroup>
          </FormField>
          <FormField label="Allowed Tools" optional>
            <TextInput value={allowedTools} onChange={setAllowedTools} placeholder="e.g. Bash,Read,Edit" />
          </FormField>
          <FormField label="Append System Prompt" optional>
            <TextArea value={systemPrompt} onChange={setSystemPrompt} placeholder="Additional instructions..." />
          </FormField>
        </>
      )}
    </Modal>
  );
}
