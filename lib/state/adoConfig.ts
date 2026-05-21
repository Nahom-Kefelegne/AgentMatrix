import { readFileSync, writeFileSync } from 'fs';
import { ADO_PATH as CONFIG_PATH, ensureDir, AGENTMATRIX_DIR } from './paths';

export interface AdoConfig {
  organization: string;
  project: string;
  configured: boolean;
}

export function getAdoConfig(): AdoConfig {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return { organization: '', project: '', configured: false };
  }
}

export function saveAdoConfig(config: AdoConfig): void {
  try {
    ensureDir(AGENTMATRIX_DIR);
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch {}
}
