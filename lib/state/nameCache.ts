import { readFileSync, writeFileSync } from 'fs';
import { NAMES_PATH as CACHE_PATH, ensureDir, AGENTMATRIX_DIR } from './paths';

function readCache(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(CACHE_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function writeCache(cache: Record<string, string>): void {
  try {
    ensureDir(AGENTMATRIX_DIR);
    writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
  } catch {
    // ignore
  }
}

export function getCachedName(sessionId: string): string | undefined {
  return readCache()[sessionId];
}

export function setCachedName(sessionId: string, name: string): void {
  const cache = readCache();
  cache[sessionId] = name;
  writeCache(cache);
}

/** Get all cached names (for global search) */
export function getAllCachedNames(): Record<string, string> {
  return readCache();
}
