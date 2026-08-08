import { readFileSync, writeFileSync } from 'fs';
import { SETTINGS_PATH, ensureDir, AGENTMATRIX_DIR } from './paths';
import type { OrchestratorProviderSetting } from './orchestratorProvider';
import type { CliType } from '../cli/CliProvider';

export interface AppSettings {
  autoResume: boolean;
  defaultModel: string;
  defaultPermissionMode: string;
  defaultEffort: string;
  defaultCopilotMode?: 'interactive' | 'plan' | 'autopilot';
  appendSystemPrompt: string;
  defaultCli?: CliType;
  /** Provider backing the hidden orchestrator session. 'auto' resolves at spawn
   *  time to the first available provider in ORCHESTRATOR_PROVIDER_PREFERENCE. */
  orchestratorProvider?: OrchestratorProviderSetting;
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
  defaultCopilotMode: 'interactive',
  appendSystemPrompt: '',
  orchestratorProvider: 'auto',
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
