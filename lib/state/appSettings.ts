import { readFileSync, writeFileSync } from 'fs';
import { SETTINGS_PATH, ensureDir, AGENTMATRIX_DIR } from './paths';

export interface AppSettings {
  autoResume: boolean;
  defaultModel: string;
  defaultPermissionMode: string;
  defaultEffort: string;
  appendSystemPrompt: string;
  defaultCli?: 'claude' | 'copilot';
  useAgency?: boolean;
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
    ensureDir(AGENTMATRIX_DIR);
    writeFileSync(SETTINGS_PATH, JSON.stringify(updated, null, 2));
  } catch {}
  return updated;
}
