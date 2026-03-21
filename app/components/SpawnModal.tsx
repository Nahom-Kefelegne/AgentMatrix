'use client';

import { useState, useCallback, useEffect } from 'react';
import { useSocketContext } from './SocketProvider';
import { Button } from '@/components/ui/button';
import { Modal, FormField, OptionGroup, OptionButton, TextInput, TextArea, SelectInput } from './ui/Modal';
import { FolderPicker } from './ui/FolderPicker';

const PERMISSION_MODES = [
  { value: 'default', label: 'Default', desc: 'Ask for each tool use' },
  { value: 'bypassPermissions', label: 'Skip Permissions', desc: 'Auto-approve everything (sandbox only)' },
  { value: 'acceptEdits', label: 'Accept Edits', desc: 'Auto-approve file edits, ask for others' },
  { value: 'plan', label: 'Plan Mode', desc: 'Plan only, no execution' },
  { value: 'auto', label: 'Auto', desc: 'Let Claude decide when to ask' },
];

const MODELS = [
  { value: '', label: 'Default' },
  { value: 'opus', label: 'Opus (Latest)' },
  { value: 'sonnet', label: 'Sonnet (Latest)' },
  { value: 'haiku', label: 'Haiku (Latest)' },
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
];

const EFFORT_LEVELS = [
  { value: '', label: 'Default' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

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

  useEffect(() => {
    if (!cwd) fetch('/api/system').then(r => r.json()).then(d => setCwd(d.homedir || '')).catch(() => {});
  }, []);

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
    });
    setTimeout(() => { socket.off('terminal:spawned' as any, handleSpawned); setLaunching(false); onClose(); }, 5000);
  }, [socketRef, cwd, sessionName, permissionMode, model, effort, allowedTools, systemPrompt, onClose, onSessionSpawned]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="New Session"
      footer={
        <div className="flex justify-end gap-2.5">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleLaunch} disabled={launching}>
            {launching ? 'Launching...' : 'Launch Session'}
          </Button>
        </div>
      }
    >
      <FormField label="Working Directory">
        <FolderPicker value={cwd} onChange={setCwd} />
      </FormField>

      <FormField label="Session Name" optional>
        <TextInput value={sessionName} onChange={setSessionName} placeholder="my-session" />
      </FormField>

      <FormField label="Permission Mode">
        <OptionGroup>
          {PERMISSION_MODES.map(pm => (
            <OptionButton
              key={pm.value}
              selected={permissionMode === pm.value}
              onClick={() => setPermissionMode(pm.value)}
              title={pm.desc}
            >
              {pm.label}
            </OptionButton>
          ))}
        </OptionGroup>
      </FormField>

      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="text-sm font-semibold text-primary cursor-pointer mb-4 flex items-center gap-1"
      >
        <span className="text-xs">{showAdvanced ? '▼' : '▶'}</span>
        Advanced Options
      </button>

      {showAdvanced && (
        <>
          <FormField label="Model">
            <SelectInput value={model} onChange={setModel} options={MODELS} />
          </FormField>

          <FormField label="Effort Level">
            <OptionGroup>
              {EFFORT_LEVELS.map(e => (
                <OptionButton key={e.value} selected={effort === e.value} onClick={() => setEffort(e.value)}>
                  {e.label}
                </OptionButton>
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
