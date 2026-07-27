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
  dashboardV2?: boolean;
  dashboardV2PreferenceVersion?: number;
}

export const DASHBOARD_V2_PREFERENCE_VERSION = 1;

const DEFAULTS: AppSettings = {
  autoResume: true,
  defaultModel: '',
  defaultPermissionMode: 'bypassPermissions',
  defaultEffort: '',
  appendSystemPrompt: '',
};

export function resolveDashboardV2Preference(
  settings: AppSettings,
  defaultEnabled: boolean,
): boolean {
  if (
    settings.dashboardV2PreferenceVersion === DASHBOARD_V2_PREFERENCE_VERSION
    && typeof settings.dashboardV2 === 'boolean'
  ) {
    return settings.dashboardV2;
  }
  return defaultEnabled;
}

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
