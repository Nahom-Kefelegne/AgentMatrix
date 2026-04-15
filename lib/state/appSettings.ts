import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const SETTINGS_PATH = join(homedir(), '.claude', 'agentmatrix-settings.json');

export interface AppSettings {
  autoResume: boolean;
  defaultModel: string;
  defaultPermissionMode: string;
  defaultEffort: string;
  appendSystemPrompt: string;
  defaultCli?: 'claude' | 'copilot';
}

const DEFAULTS: AppSettings = {
  autoResume: true,
  defaultModel: '',
  defaultPermissionMode: 'bypassPermissions',
  defaultEffort: '',
  appendSystemPrompt: '',
};

export function getSettings(): AppSettings {
  try {
    const data = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'));
    return { ...DEFAULTS, ...data };
  } catch {
    return { ...DEFAULTS };
  }
}

export function updateSettings(partial: Partial<AppSettings>): AppSettings {
  const current = getSettings();
  const updated = { ...current, ...partial };
  try {
    writeFileSync(SETTINGS_PATH, JSON.stringify(updated, null, 2));
  } catch {}
  return updated;
}
