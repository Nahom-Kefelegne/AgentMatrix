import type { CliType, CliProvider, CliHealth } from './CliProvider';
import { ClaudeProvider } from './ClaudeProvider';
import { CopilotProvider } from './CopilotProvider';
import { KimiProvider } from './KimiProvider';

export type { CliType, CliProvider, CliHealth, SpawnOptions, ResumeOptions } from './CliProvider';

export interface AgencyHealth {
  installed: boolean;
  version: string | null;
  binaryPath: string | null;
}

/** Check if Microsoft Agency is available. */
export function checkAgencyHealth(): AgencyHealth {
  const { execSync } = require('child_process');
  try {
    const ver = execSync('agency --version', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const match = ver.match(/agency\s+([\d.]+)/i);
    // Find binary path
    let binaryPath: string | null = null;
    try {
      const cmd = process.platform === 'win32' ? 'where agency' : 'which agency';
      binaryPath = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim().split('\n')[0];
    } catch {}
    return { installed: true, version: match ? match[1] : ver, binaryPath };
  } catch {
    return { installed: false, version: null, binaryPath: null };
  }
}

const providerInstances = new Map<CliType, CliProvider>();

function getOrCreateProvider(type: CliType): CliProvider {
  let provider = providerInstances.get(type);
  if (!provider) {
    switch (type) {
      case 'claude':
        provider = new ClaudeProvider();
        break;
      case 'copilot':
        provider = new CopilotProvider();
        break;
      case 'kimi':
        provider = new KimiProvider();
        break;
      default:
        throw new Error(`Unknown CLI type: ${type}`);
    }
    providerInstances.set(type, provider);
  }
  return provider;
}

/** Get a provider instance for the given CLI type. */
export function getProvider(type: CliType): CliProvider {
  return getOrCreateProvider(type);
}

/** All known providers, one per CliType. Used by callers that need to
 *  scan / probe / aggregate across all supported CLIs (session discovery,
 *  process detection, etc.). Providers are cached singletons. */
export function allProviders(): CliProvider[] {
  const types: CliType[] = ['claude', 'copilot', 'kimi'];
  return types.map(getOrCreateProvider);
}

/** Detect which CLIs are installed on this system. */
export function detectInstalledCLIs(): CliType[] {
  const installed: CliType[] = [];
  const types: CliType[] = ['claude', 'copilot', 'kimi'];

  for (const type of types) {
    try {
      const provider = getOrCreateProvider(type);
      provider.findBinary();
      installed.push(type);
    } catch {
      // Not installed
    }
  }

  return installed;
}

/** Check health of all known CLI types. */
export function checkAllHealth(): CliHealth[] {
  const types: CliType[] = ['claude', 'copilot', 'kimi'];
  return types.map(type => {
    const provider = getOrCreateProvider(type);
    return provider.checkHealth();
  });
}

/** Get the default provider — uses settings if available, otherwise first installed CLI. */
export function getDefaultProvider(): CliProvider {
  // Try to read defaultCli from settings
  try {
    const { getSettings } = require('../state/appSettings');
    const settings = getSettings();
    if (settings.defaultCli) {
      const provider = getOrCreateProvider(settings.defaultCli);
      try {
        provider.findBinary();
        return provider;
      } catch {
        // Configured default not available, fall through
      }
    }
  } catch {
    // Settings module not available (e.g. in browser context)
  }

  // Fallback: first installed CLI
  const installed = detectInstalledCLIs();
  if (installed.length > 0) {
    return getOrCreateProvider(installed[0]);
  }

  // Ultimate fallback: return Claude provider (will throw on findBinary if not installed)
  return getOrCreateProvider('claude');
}
