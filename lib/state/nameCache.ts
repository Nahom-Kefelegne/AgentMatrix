import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CACHE_PATH = join(homedir(), '.claude', 'agentmatrix-names.json');

function readCache(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(CACHE_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function writeCache(cache: Record<string, string>): void {
  try {
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
