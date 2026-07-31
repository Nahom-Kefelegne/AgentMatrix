import { execFileSync } from 'child_process';
import { chmodSync, existsSync, mkdirSync, realpathSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { delimiter, dirname, join } from 'path';

const MICROSOFT_NPM_PROXY = 'https://packagefeedproxy.microsoft.io/npm/';
const WRAPPER_DIR = join(homedir(), '.agentmatrix', 'bin');
const TEAMS_LAUNCHER = '@teams-eng-mcp/launcher@latest';
const MANAGED_SCOPES = ['teams-eng-mcp', 'modelcontextprotocol', 'anthropic'];

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

function npmCachePath(realNpm: string, nodePath: string, cliPath: string | null): string | null {
  const windowsBatch = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(realNpm);
  if (windowsBatch && !cliPath) return null;
  try {
    const command = cliPath ? nodePath : realNpm;
    const commandArgs = cliPath
      ? [cliPath, '--no-update-notifier', 'config', 'get', 'cache']
      : ['--no-update-notifier', 'config', 'get', 'cache'];
    const output = execFileSync(
      command,
      commandArgs,
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

function npmCliPath(commandPath: string, command: 'npm' | 'npx'): string | null {
  try {
    const resolved = realpathSync(commandPath);
    if (resolved.endsWith(`${command}-cli.js`)) return resolved;
  } catch { /* try the Windows layout */ }
  const candidate = join(dirname(commandPath), 'node_modules', 'npm', 'bin', `${command}-cli.js`);
  return existsSync(candidate) ? candidate : null;
}

function npmValueOptions(cliPath: string | null): string[] {
  const fallback = [
    '--registry', '--reg', '--metrics-registry', '--replace-registry-host',
    '--userconfig', '--globalconfig', '--prefix', '--cache', '--workspace', '-w',
    '--script-shell', '--call', '-c', '--package', '-p', '--loglevel', '--tag',
    '--otp', '--before', '--include', '--omit', '--install-strategy',
    '--fetch-retries', '--fetch-retry-factor', '--fetch-retry-mintimeout',
    '--fetch-retry-maxtimeout', '--fetch-timeout', '--proxy', '--https-proxy',
    '--noproxy', '--scope', '--access', '--auth-type',
  ];
  if (!cliPath) return fallback;
  try {
    const npmRoot = dirname(dirname(cliPath));
    const { definitions } = require(join(
      npmRoot,
      'node_modules',
      '@npmcli',
      'config',
      'lib',
      'definitions',
    ));
    const options = new Set(fallback);
    for (const [key, definition] of Object.entries(definitions) as Array<[string, any]>) {
      const type = definition?.type;
      const booleanCapable = type === Boolean
        || (Array.isArray(type) && type.includes(Boolean));
      if (booleanCapable) continue;
      options.add(`--${key}`);
      const usage = typeof definition?.usage === 'string' ? definition.usage : '';
      const short = usage.match(/(-[A-Za-z])\|--/);
      if (short) options.add(short[1]);
    }
    return [...options];
  } catch {
    return fallback;
  }
}

function npmConfiguredScopes(realNpm: string, nodePath: string, cliPath: string | null): string[] {
  const windowsBatch = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(realNpm);
  if (windowsBatch && !cliPath) return [];
  try {
    const command = cliPath ? nodePath : realNpm;
    const commandArgs = cliPath
      ? [cliPath, '--no-update-notifier', 'config', 'list', '--json']
      : ['--no-update-notifier', 'config', 'list', '--json'];
    const config = JSON.parse(execFileSync(command, commandArgs, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      env: {
        ...process.env,
        NPM_CONFIG_REGISTRY: MICROSOFT_NPM_PROXY,
        NPM_CONFIG_REPLACE_REGISTRY_HOST: 'npmjs',
        NPM_CONFIG_UPDATE_NOTIFIER: 'false',
        NPM_CONFIG_AUDIT: 'false',
        NPM_CONFIG_FUND: 'false',
        NO_UPDATE_NOTIFIER: '1',
      },
    }));
    return Object.keys(config)
      .map(key => key.match(/^@([^:]+):registry$/i)?.[1].toLowerCase())
      .filter((scope): scope is string => Boolean(scope));
  } catch {
    return [];
  }
}

function wrapperProgram(
  commandName: 'npm' | 'npx',
  realCommand: string,
  cliPath: string | null,
  cachePath: string | null,
  configuredScopes: string[],
  valueOptions: string[],
): string {
  return `
const { spawn } = require('child_process');
const { existsSync, readdirSync } = require('fs');
const { join } = require('path');

const commandName = ${JSON.stringify(commandName)};
const realCommand = ${JSON.stringify(realCommand)};
const cliPath = ${JSON.stringify(cliPath)};
const launcher = ${JSON.stringify(TEAMS_LAUNCHER)};
const registry = ${JSON.stringify(MICROSOFT_NPM_PROXY)};
const npmCache = ${JSON.stringify(cachePath)};
const managedScopes = ${JSON.stringify([...new Set([...MANAGED_SCOPES, ...configuredScopes])])};
const valueOptions = new Set(${JSON.stringify(valueOptions)});
const original = process.argv.slice(2);
const teamsPackage = launcher.replace(/@latest$/, '');
const npmCommandWords = new Set([
  'exec', 'x', 'install', 'i', 'add', 'update', 'up', 'ci', 'run', 'run-script',
  'config', 'view', 'show', 'info', 'search', 'uninstall', 'remove', 'rm',
]);
const packageCommands = new Set(['install', 'i', 'add', 'update', 'up', 'uninstall', 'remove', 'rm']);

function packageName(spec) {
  const aliasIndex = spec.indexOf('npm:');
  const value = aliasIndex >= 0 ? spec.slice(aliasIndex + 4) : spec;
  if (value.startsWith('@')) {
    const slash = value.indexOf('/');
    if (slash < 0) return value;
    const version = value.indexOf('@', slash);
    return version >= 0 ? value.slice(0, version) : value;
  }
  const version = value.indexOf('@');
  return version > 0 ? value.slice(0, version) : value;
}

function optionConsumesValue(argument) {
  if (argument.includes('=')) return false;
  return valueOptions.has(argument.toLowerCase());
}

function parsePackages(args) {
  const specs = [];
  const valueIndexes = new Set();
  let commandIndex = -1;
  let npmCommand = null;
  const separatorIndex = args.indexOf('--');
  const limit = separatorIndex >= 0 ? separatorIndex : args.length;
  for (let index = 0; index < limit; index += 1) {
    const argument = args[index];
    if (argument === '--package' || argument === '-p') {
      if (args[index + 1]) {
        specs.push(args[index + 1]);
        valueIndexes.add(index + 1);
      }
      index += 1;
      continue;
    }
    if (argument.startsWith('--package=')) {
      specs.push(argument.slice('--package='.length));
      continue;
    }
    if (argument.startsWith('-p=')) {
      specs.push(argument.slice(3));
      continue;
    }
    if (argument.startsWith('-p') && argument.length > 2) {
      specs.push(argument.slice(2));
      continue;
    }
    if (optionConsumesValue(argument)) {
      index += 1;
      continue;
    }
    if (argument.startsWith('-')) continue;
    if (npmCommandWords.has(argument) && !npmCommand) {
      npmCommand = argument;
      continue;
    }
    specs.push(argument);
    if (commandIndex < 0) commandIndex = index;
    if (!(commandName === 'npm' && npmCommand && packageCommands.has(npmCommand))) break;
  }
  if (separatorIndex >= 0 && args[separatorIndex + 1]) {
    const packageSuffix = commandName === 'npm' && npmCommand && packageCommands.has(npmCommand)
      ? args.slice(separatorIndex + 1)
      : [args[separatorIndex + 1]];
    specs.push(...packageSuffix);
    if (commandIndex < 0) commandIndex = separatorIndex + 1;
  }
  return { specs, valueIndexes, commandIndex, separatorIndex, npmCommand };
}

function approvedTeamsRegistry(value) {
  try {
    const url = new URL(value);
    const azureHost = url.hostname === 'pkgs.dev.azure.com'
      || url.hostname.endsWith('.pkgs.visualstudio.com');
    return url.protocol === 'https:'
      && azureHost
      && url.pathname.includes('/_packaging/')
      && /\\/npm\\/registry\\/?$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function findApprovedTeamsRegistry(args) {
  const separatorIndex = args.indexOf('--');
  const limit = separatorIndex >= 0 ? separatorIndex : args.length;
  let approved = null;
  for (let index = 0; index < limit; index += 1) {
    const argument = args[index];
    const key = argument.split('=', 1)[0].toLowerCase();
    const registryAlias = key.length >= '--reg'.length && '--registry'.startsWith(key);
    if (!registryAlias) continue;
    const value = argument.includes('=') ? argument.slice(argument.indexOf('=') + 1) : args[index + 1];
    if (!argument.includes('=')) index += 1;
    if (value && approvedTeamsRegistry(value)) approved = value;
  }
  return approved;
}

function addScopesFromNpmrc(scopes, path) {
  if (!path) return;
  try {
    const text = require('fs').readFileSync(path, 'utf8');
    for (const line of text.split(/\\r?\\n/)) {
      const match = line.match(/^\\s*@([^:]+):registry\\s*=/i);
      if (match) scopes.add(match[1].toLowerCase());
    }
  } catch { /* config is optional */ }
}

function addRuntimeConfiguredScopes(scopes) {
  for (const key of Object.keys(process.env)) {
    const match = key.match(/^npm_config_@([^:]+):registry$/i);
    if (match) scopes.add(match[1].toLowerCase());
  }
  const { homedir } = require('os');
  const { dirname, join, resolve } = require('path');
  addScopesFromNpmrc(scopes, process.env.NPM_CONFIG_USERCONFIG || join(homedir(), '.npmrc'));
  addScopesFromNpmrc(scopes, process.env.NPM_CONFIG_GLOBALCONFIG);
  let current = resolve(process.cwd());
  while (true) {
    addScopesFromNpmrc(scopes, join(current, '.npmrc'));
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

function hasPublicNpmUrl(argument) {
  const matches = argument.match(/https?:\\/\\/[^\\s]+/ig) || [];
  return matches.some(value => {
    try {
      return new URL(value).hostname.toLowerCase().replace(/\\.+$/, '') === 'registry.npmjs.org';
    } catch {
      return false;
    }
  });
}

function removePolicyOverrides(args) {
  const output = [];
  const valuedOptions = new Set([
    '--registry',
    '--replace-registry-host',
    '--metrics-registry',
    '--userconfig',
    '--globalconfig',
  ]);
  const booleanOptions = new Set([
    '--update-notifier',
    '--audit',
    '--fund',
    '--prefer-online',
    '--prefer-offline',
    '--offline',
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--') {
      output.push(...args.slice(index));
      break;
    }
    const key = argument.split('=', 1)[0].toLowerCase();
    const normalizedBoolean = key.replace(/^--no-/, '--');
    const registryAlias = key.length >= '--reg'.length && '--registry'.startsWith(key);
    const scopedConfig = key.match(/^--@[^:]+:(.+)$/i);
    const scopedRegistry = Boolean(
      scopedConfig
      && scopedConfig[1].length >= 'reg'.length
      && 'registry'.startsWith(scopedConfig[1]),
    );
    if (valuedOptions.has(key) || registryAlias || scopedRegistry) {
      if (!argument.includes('=') && args[index + 1]) index += 1;
      continue;
    }
    if (booleanOptions.has(normalizedBoolean)) continue;
    output.push(argument);
  }
  return output;
}

const parsedOriginal = parsePackages(original);
const specs = parsedOriginal.specs;
const executableCommand = commandName === 'npx'
  || parsedOriginal.npmCommand === 'exec'
  || parsedOriginal.npmCommand === 'x';
const usesTeamsLauncher = executableCommand
  && specs.some(spec => packageName(spec) === teamsPackage);
const teamsRegistry = usesTeamsLauncher ? findApprovedTeamsRegistry(original) : null;
const effectiveRegistry = teamsRegistry || registry;
const requestedScopes = new Set(managedScopes);
addRuntimeConfiguredScopes(requestedScopes);
for (const spec of specs) {
  const aliasIndex = spec.indexOf('npm:');
  const value = aliasIndex >= 0 ? spec.slice(aliasIndex + 4) : spec;
  const match = value.match(/^@([^/\\s]+)\\//);
  if (match) requestedScopes.add(match[1].toLowerCase());
}
const env = {
  ...process.env,
  NPM_CONFIG_REGISTRY: effectiveRegistry,
  NPM_CONFIG_REPLACE_REGISTRY_HOST: 'npmjs',
  NPM_CONFIG_UPDATE_NOTIFIER: 'false',
  NPM_CONFIG_AUDIT: 'false',
  NPM_CONFIG_FUND: 'false',
  NPM_CONFIG_PREFER_OFFLINE: 'true',
  NO_UPDATE_NOTIFIER: '1',
};
for (const scope of requestedScopes) {
  env['npm_config_@' + scope + ':registry'] =
    scope === 'teams-eng-mcp' && teamsRegistry ? teamsRegistry : registry;
}

let managed = removePolicyOverrides(original);
const managedInvocation = parsePackages(managed);
if (managedInvocation.specs.some(argument => hasPublicNpmUrl(argument))) {
  console.error('[npm-policy] Explicit registry.npmjs.org package URLs are blocked; use the Microsoft package proxy.');
  process.exit(1);
}
if (usesTeamsLauncher) {
  managed = managed.filter(argument => argument !== '--no-update');
  if (managed.some(argument =>
    argument === '-c'
    || argument.startsWith('-c=')
    || argument === '--call'
    || argument.startsWith('--call=')
  )) {
    console.error('[npm-policy] Teams launcher shell-call forms are unsupported; use the direct launcher command.');
    process.exit(1);
  }
  const parsedManaged = parsePackages(managed);
  if (parsedManaged.commandIndex < 0) {
    console.error('[npm-policy] Could not locate the Teams launcher command.');
    process.exit(1);
  }
  managed.splice(parsedManaged.commandIndex + 1, 0, '--no-update');
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
  const offline = usesTeamsLauncher && hasCachedLauncher();
  const policyArgs = [
    '--no-update-notifier',
    '--registry=' + effectiveRegistry,
    '--replace-registry-host=npmjs',
    '--no-audit',
    '--no-fund',
    '--prefer-offline',
    ...Array.from(requestedScopes, scope =>
      '--@' + scope + ':registry='
      + (scope === 'teams-eng-mcp' && teamsRegistry ? teamsRegistry : registry)
    ),
  ];
  const args = [...policyArgs, ...(offline ? ['--offline'] : []), ...managed];
  const windowsCommand = process.platform === 'win32' && /\\.(?:cmd|bat)$/i.test(realCommand);
  if (windowsCommand && !cliPath) {
    console.error('[npm-policy] Could not resolve npm CLI entry point; refusing an unmanaged Windows npm request.');
    process.exit(1);
    return;
  }
  const executable = cliPath ? process.execPath : realCommand;
  const executableArgs = cliPath ? [cliPath, ...args] : args;
  active = spawn(executable, executableArgs, { env, stdio: 'inherit', windowsHide: true });
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
    const npmCli = npmCliPath(realNpm, 'npm');
    const npxCli = npmCliPath(realNpx, 'npx');
    const cachePath = npmCachePath(realNpm, nodePath, npmCli);
    const configuredScopes = npmConfiguredScopes(realNpm, nodePath, npmCli);
    const valueOptions = npmValueOptions(npmCli);
    writeFileSync(
      npmProgram,
      wrapperProgram('npm', realNpm, npmCli, cachePath, configuredScopes, valueOptions),
      'utf8',
    );
    writeFileSync(
      npxProgram,
      wrapperProgram('npx', realNpx, npxCli, cachePath, configuredScopes, valueOptions),
      'utf8',
    );

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
