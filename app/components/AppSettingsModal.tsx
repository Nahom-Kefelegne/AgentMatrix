'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSocketContext } from './SocketProvider';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
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

function ToggleSetting({ label, description, checked, onChange }: {
  label: string; description: string; checked: boolean; onChange: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3.5">
      <div className="flex-1">
        <div className="text-base font-semibold text-foreground mb-1">{label}</div>
        <div className="text-sm text-muted-foreground leading-relaxed">{description}</div>
      </div>
      <button
        onClick={onChange}
        className={cn(
          'w-12 h-[26px] rounded-full relative cursor-pointer shrink-0 mt-0.5 transition-colors duration-200',
          checked ? 'bg-primary' : 'bg-muted',
        )}
      >
        <div className={cn(
          'size-5 rounded-full bg-white absolute top-[3px] transition-[left] duration-200',
          checked ? 'left-[25px]' : 'left-[3px]',
        )} />
      </button>
    </div>
  );
}

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
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Settings"
      width="max-w-[520px]"
      footer={
        <div className="flex justify-end">
          <span className={cn('text-sm', saving ? 'text-primary' : 'text-muted-foreground')}>
            {saving ? 'Saving...' : 'Auto-saved'}
          </span>
        </div>
      }
    >
      <ToggleSetting
        label="Auto-resume sessions"
        description="Resume all active sessions when the app starts."
        checked={settings.autoResume}
        onChange={() => save({ autoResume: !settings.autoResume })}
      />

      <div className="border-b border-border/50 my-1" />

      <FormField label="Default model">
        <div className="text-sm text-muted-foreground mb-2">Model used for new sessions unless overridden.</div>
        <SelectInput value={settings.defaultModel} onChange={v => save({ defaultModel: v })} options={MODELS} />
      </FormField>

      <div className="border-b border-border/50 my-1" />

      <FormField label="Default permission mode">
        <div className="text-sm text-muted-foreground mb-2">Permission mode for new sessions.</div>
        <OptionGroup>
          {PERMISSION_MODES.map(pm => (
            <OptionButton key={pm.value} selected={settings.defaultPermissionMode === pm.value} onClick={() => save({ defaultPermissionMode: pm.value })} title={pm.desc}>
              {pm.label}
            </OptionButton>
          ))}
        </OptionGroup>
      </FormField>

      <div className="border-b border-border/50 my-1" />

      <FormField label="Default effort level">
        <div className="text-sm text-muted-foreground mb-2">Effort level for new sessions.</div>
        <OptionGroup>
          {EFFORT_LEVELS.map(e => (
            <OptionButton key={e.value} selected={settings.defaultEffort === e.value} onClick={() => save({ defaultEffort: e.value })}>
              {e.label}
            </OptionButton>
          ))}
        </OptionGroup>
      </FormField>

      <div className="border-b border-border/50 my-1" />

      <FormField label="Append to system prompt">
        <div className="text-sm text-muted-foreground mb-2">
          Additional instructions appended to Claude&apos;s default system prompt for all new sessions.
        </div>
        <TextArea
          value={settings.appendSystemPrompt}
          onChange={v => setSettings({ ...settings, appendSystemPrompt: v })}
          placeholder="e.g. Always write tests. Use TypeScript..."
          rows={4}
        />
        <Button variant="outline" size="sm" className="mt-2" onClick={() => save({ appendSystemPrompt: settings.appendSystemPrompt })}>
          Save prompt
        </Button>
      </FormField>

      <div className="border-b border-border/50 my-1" />

      {/* Orchestrator */}
      <div className="py-3.5">
        <div className="text-base font-semibold text-foreground mb-1">Orchestrator Session</div>
        <div className="text-sm text-muted-foreground mb-3">
          Internal Claude session used for deep search and app tasks.
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!orchestratorId}
            onClick={() => {
              if (orchestratorId && onViewOrchestrator) { onClose(); onViewOrchestrator(orchestratorId); }
            }}
          >
            {orchestratorId ? 'View Orchestrator' : 'Not running'}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={!orchestratorId}
            onClick={() => {
              if (!confirm('Reset orchestrator? All context will be lost.')) return;
              socketRef.current?.emit('orchestrator:reset' as any);
            }}
          >
            Reset
          </Button>
        </div>
        {orchestratorId && (
          <div className="text-xs text-muted-foreground mt-2 font-mono">{orchestratorId.slice(0, 12)}...</div>
        )}
      </div>
    </Modal>
  );
}
