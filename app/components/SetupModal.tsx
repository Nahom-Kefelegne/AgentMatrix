'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  CircleAlert,
  Copy,
  RefreshCw,
  Wrench,
} from 'lucide-react';
import type { CliType } from '@/lib/types';
import CliIcon, { CLI_ICON_META } from './CliIcon';
import { Modal } from './ui/Modal';

interface SetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  connected: boolean;
  sessionCount: number;
}

interface CliHealthInfo {
  type: CliType;
  installed: boolean;
  version: string | null;
  binaryPath: string | null;
  error?: string;
}

interface IntegrationHealth {
  clis: CliHealthInfo[];
  agency: { installed: boolean; version: string | null } | null;
}

const START_COMMANDS = {
  windows: '.\\start.ps1',
  unix: './start.sh',
};

export default function SetupModal({ isOpen, onClose, connected, sessionCount }: SetupModalProps) {
  const [health, setHealth] = useState<IntegrationHealth>({ clis: [], agency: null });
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/cli/health');
      const data = await response.json();
      setHealth({ clis: data.clis || [], agency: data.agency || null });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) void refresh();
  }, [isOpen, refresh]);

  const copy = (key: string, value: string) => {
    navigator.clipboard.writeText(value);
    setCopied(key);
    window.setTimeout(() => setCopied(null), 1_800);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Integration Status"
      eyebrow="Setup and Health"
      description="AgentMatrix manages its runtime integrations automatically. This view reports what is ready and where configuration is owned."
      icon={<Wrench size={16} />}
      maxWidth={680}
      headerActions={(
        <button type="button" className="btn-outline" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw size={13} aria-hidden="true" />
          {loading ? 'Checking…' : 'Refresh'}
        </button>
      )}
    >
      <section className="cc-setup-summary">
        <div className={`cc-setup-signal ${connected ? 'cc-setup-signal--ready' : 'cc-setup-signal--error'}`}>
          {connected ? <CheckCircle2 size={17} aria-hidden="true" /> : <CircleAlert size={17} aria-hidden="true" />}
          <div>
            <strong>{connected ? 'Control Center connected' : 'Control Center disconnected'}</strong>
            <span>{sessionCount} active {sessionCount === 1 ? 'session' : 'sessions'}</span>
          </div>
        </div>
        <div className="cc-setup-signal cc-setup-signal--ready">
          <CheckCircle2 size={17} aria-hidden="true" />
          <div>
            <strong>Navigation tools managed</strong>
            <span>AgentMatrix MCP and renderer capabilities refresh on startup.</span>
          </div>
        </div>
      </section>

      <section className="cc-settings-section">
        <div className="cc-settings-section-heading">
          <span>Providers</span>
          <strong>Detected CLI runtimes</strong>
          <p>At least one provider must be installed directly or launched through Microsoft Agency.</p>
        </div>
        <div className="cc-setup-provider-list">
          {(['copilot', 'claude'] as CliType[]).map(type => {
            const provider = health.clis.find(item => item.type === type);
            return (
              <div key={type} className="cc-setup-provider">
                <span className="cc-settings-provider-icon"><CliIcon cliType={type} /></span>
                <div>
                  <strong>{CLI_ICON_META[type].name}</strong>
                  <code>{provider?.binaryPath || provider?.error || 'Not detected'}</code>
                </div>
                <span className={provider?.installed ? 'cc-setup-ready' : 'cc-setup-missing'}>
                  {provider?.installed ? provider.version || 'Ready' : 'Missing'}
                </span>
              </div>
            );
          })}
          <div className="cc-setup-provider">
            <span className="cc-settings-provider-icon">A</span>
            <div>
              <strong>Microsoft Agency</strong>
              <code>Optional provider launcher</code>
            </div>
            <span className={health.agency?.installed ? 'cc-setup-ready' : 'cc-setup-neutral'}>
              {health.agency?.installed ? health.agency.version || 'Ready' : 'Optional'}
            </span>
          </div>
        </div>
      </section>

      <section className="cc-settings-section">
        <div className="cc-settings-section-heading">
          <span>Managed Configuration</span>
          <strong>No manual hook JSON required</strong>
          <p>AgentMatrix refreshes its supported integrations through the app and setup scripts.</p>
        </div>
        <div className="cc-setup-managed-list">
          <div>
            <span>GitHub Copilot hooks</span>
            <code>~/.copilot/hooks/agentmatrix.json</code>
            <small>Generated by AgentMatrix at startup with localhost hook support.</small>
          </div>
          <div>
            <span>Claude Code hooks</span>
            <code>~/.claude/settings.json</code>
            <small>Installed and refreshed by setup/update scripts with fail-open transport.</small>
          </div>
          <div>
            <span>AgentMatrix MCP</span>
            <code>Session-bound additional MCP config</code>
            <small>Passed to managed Copilot sessions with eager tool loading.</small>
          </div>
        </div>
      </section>

      <section className="cc-settings-section cc-settings-section--diagnostics">
        <div className="cc-settings-section-heading">
          <span>Launch Commands</span>
          <strong>Run from a separate system terminal</strong>
          <p>Hosted sessions cannot restart their own AgentMatrix process.</p>
        </div>
        <div className="cc-setup-command-list">
          {([
            ['windows', 'Windows PowerShell', START_COMMANDS.windows],
            ['unix', 'macOS / Linux', START_COMMANDS.unix],
          ] as const).map(([key, label, command]) => (
            <div key={key}>
              <span>{label}</span>
              <code>{command}</code>
              <button type="button" className="btn-outline" onClick={() => copy(key, command)}>
                {copied === key ? <CheckCircle2 size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
                {copied === key ? 'Copied' : 'Copy'}
              </button>
            </div>
          ))}
        </div>
      </section>
    </Modal>
  );
}
