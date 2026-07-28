import { execFileSync } from 'child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { delimiter, join } from 'path';

const MICROSOFT_NPM_PROXY = 'https://packagefeedproxy.microsoft.io/npm/';
const WRAPPER_DIR = join(homedir(), '.agentmatrix', 'bin');
const TEAMS_LAUNCHER = '@teams-eng-mcp/launcher@latest';

let cachedWrapperDir: string | null | undefined;

function findExecutable(name: string): string | null {
  try {
    const command = process.platform === 'win32' ? 'where' : 'which';
    const output = execFileSync(command, [name], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    const candidates = output.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    if (process.platform === 'win32') {
      return candidates.find(value => /\.(?:cmd|exe)$/i.test(value)) ?? candidates[0] ?? null;
    }
    return candidates[0] ?? null;
  } catch {
    return null;
  }
}

function npmCachePath(realNpm: string): string | null {
  try {
    const output = execFileSync(
      realNpm,
      ['--no-update-notifier', 'config', 'get', 'cache'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
        env: {
          ...process.env,
          NPM_CONFIG_UPDATE_NOTIFIER: 'false',
          NO_UPDATE_NOTIFIER: '1',
        },
      },
    ).trim();
    return output || null;
  } catch {
    return null;
  }
}

function wrapperProgram(realNpm: string, cachePath: string | null): string {
  return `
const { spawn } = require('child_process');
const { existsSync, readdirSync } = require('fs');
const { join } = require('path');

const realNpm = ${JSON.stringify(realNpm)};
const launcher = ${JSON.stringify(TEAMS_LAUNCHER)};
const registry = ${JSON.stringify(MICROSOFT_NPM_PROXY)};
const npmCache = ${JSON.stringify(cachePath)};
const original = process.argv.slice(2);
const launcherIndex = original.indexOf(launcher);
const env = {
  ...process.env,
  NPM_CONFIG_REGISTRY: process.env.NPM_CONFIG_REGISTRY || registry,
  NPM_CONFIG_REPLACE_REGISTRY_HOST: 'never',
  NPM_CONFIG_UPDATE_NOTIFIER: 'false',
  NPM_CONFIG_AUDIT: 'false',
  NPM_CONFIG_FUND: 'false',
  NO_UPDATE_NOTIFIER: '1',
};

const managed = [...original];
if (launcherIndex >= 0 && managed[launcherIndex + 1] !== '--no-update') {
  managed.splice(launcherIndex + 1, 0, '--no-update');
}

let active = null;

function hasCachedLauncher() {
  if (!npmCache) return false;
  const root = join(npmCache, '_npx');
  if (!existsSync(root)) return false;
  try {
    return readdirSync(root).some(entry => existsSync(
      join(root, entry, 'node_modules', '@teams-eng-mcp', 'launcher', 'package.json'),
    ));
  } catch {
    return false;
  }
}

function run() {
  const offline = launcherIndex >= 0 && hasCachedLauncher();
  const args = ['--no-update-notifier', ...(offline ? ['--offline'] : []), ...managed];
  active = spawn(realNpm, args, { env, stdio: 'inherit', windowsHide: true });
  active.once('error', () => { process.exitCode = 1; });
  active.once('exit', (code, signal) => {
    if (signal) {
      process.exit(1);
      return;
    }
    process.exit(code ?? 1);
  });
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    try { active?.kill(signal); } catch {}
  });
}

run();
`.trimStart();
}

function writeUnixLauncher(name: 'npm' | 'npx', nodePath: string, programPath: string): void {
  const path = join(WRAPPER_DIR, name);
  writeFileSync(path, `#!/bin/sh\nexec ${JSON.stringify(nodePath)} ${JSON.stringify(programPath)} "$@"\n`, 'utf8');
  chmodSync(path, 0o755);
}

function writeWindowsLauncher(name: 'npm' | 'npx', nodePath: string, programPath: string): void {
  const path = join(WRAPPER_DIR, `${name}.cmd`);
  writeFileSync(
    path,
    `@echo off\r\n"${nodePath}" "${programPath}" %*\r\nexit /b %ERRORLEVEL%\r\n`,
    'utf8',
  );
}

/**
 * Builds npm/npx shims for managed CLI processes. Agency intentionally strips
 * npm configuration variables from MCP server environments; placing these
 * shims first on PATH reapplies AgentMatrix's Microsoft-mirror policy at the
 * actual child process boundary.
 */
export function ensureManagedNpmPolicy(): string | null {
  if (cachedWrapperDir !== undefined) return cachedWrapperDir;

  const nodePath = findExecutable('node');
  const realNpm = findExecutable('npm');
  const realNpx = findExecutable('npx');
  if (!nodePath || !realNpm || !realNpx) {
    cachedWrapperDir = null;
    return null;
  }

  try {
    mkdirSync(WRAPPER_DIR, { recursive: true });
    const npmProgram = join(WRAPPER_DIR, 'npm-policy.cjs');
    const npxProgram = join(WRAPPER_DIR, 'npx-policy.cjs');
    writeFileSync(npmProgram, wrapperProgram(realNpm, npmCachePath(realNpm)), 'utf8');
    writeFileSync(npxProgram, wrapperProgram(realNpx, npmCachePath(realNpm)), 'utf8');

    if (process.platform === 'win32') {
      writeWindowsLauncher('npm', nodePath, npmProgram);
      writeWindowsLauncher('npx', nodePath, npxProgram);
    } else {
      writeUnixLauncher('npm', nodePath, npmProgram);
      writeUnixLauncher('npx', nodePath, npxProgram);
    }
    cachedWrapperDir = WRAPPER_DIR;
    return WRAPPER_DIR;
  } catch (error) {
    console.error('[npm-policy] Failed to create managed npm wrappers:', error);
    cachedWrapperDir = null;
    return null;
  }
}

export function prependManagedNpmPolicy(env: NodeJS.ProcessEnv): void {
  const wrapperDir = ensureManagedNpmPolicy();
  if (!wrapperDir) return;
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') ?? 'PATH';
  const current = env[pathKey] || '';
  env[pathKey] = current ? `${wrapperDir}${delimiter}${current}` : wrapperDir;
}
