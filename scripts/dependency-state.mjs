#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.AGENTMATRIX_DEPENDENCY_ROOT
  ? path.resolve(process.env.AGENTMATRIX_DEPENDENCY_ROOT)
  : path.resolve(scriptDir, '..');
const nodeModules = path.join(root, 'node_modules');
const stampPath = path.join(nodeModules, '.agentmatrix-dependencies.json');
const schemaVersion = 1;
const require = createRequire(import.meta.url);

function manifestHash() {
  const hash = createHash('sha256');
  for (const filename of ['package.json', 'package-lock.json']) {
    hash.update(filename);
    hash.update('\0');
    hash.update(readFileSync(path.join(root, filename)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function expectedState() {
  return {
    schemaVersion,
    manifestHash: manifestHash(),
    platform: process.platform,
    arch: process.arch,
    nodeAbi: process.versions.modules ?? null,
  };
}

function packageManifest() {
  return JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
}

function directDependencies() {
  const manifest = packageManifest();
  return new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ]);
}

function dependencyPackageJson(name) {
  return path.join(nodeModules, ...name.split('/'), 'package.json');
}

function nativeDirectories() {
  if (process.platform === 'win32') return [];
  const nodePty = path.join(nodeModules, 'node-pty');
  const relativeRoots = [nodePty, path.join(nodePty, 'lib')];
  const directories = [
    ['build', 'Release'],
    ['build', 'Debug'],
    ['prebuilds', `${process.platform}-${process.arch}`],
  ];
  return directories.flatMap(parts => relativeRoots.map(base => path.join(base, ...parts)));
}

function nativeHelperCandidates() {
  return [
    ...nativeDirectories().map(directory => path.join(directory, 'spawn-helper')),
  ];
}

function repairNativeArtifacts() {
  for (const helper of nativeHelperCandidates()) {
    if (existsSync(helper)) chmodSync(helper, 0o755);
  }
}

function invalidNativeArtifact() {
  const directories = nativeDirectories();
  if (!directories.length) return null;
  let selectedDirectory = null;
  let foundAddon = false;
  for (const directory of directories) {
    const addon = path.join(directory, 'pty.node');
    if (!existsSync(addon)) continue;
    foundAddon = true;
    try {
      require(addon);
      selectedDirectory = directory;
      break;
    } catch {
      // Follow node-pty's fallback order when an addon is present but unloadable.
    }
  }
  if (!selectedDirectory) {
    return foundAddon
      ? `node-pty pty.node is not loadable for ${process.platform}-${process.arch}`
      : `node-pty pty.node is missing for ${process.platform}-${process.arch}`;
  }

  const helper = path.join(selectedDirectory, 'spawn-helper');
  if (!existsSync(helper)) {
    return `node-pty spawn-helper is missing beside ${path.relative(nodeModules, selectedDirectory)}/pty.node`;
  }
  try {
    accessSync(helper, constants.X_OK);
    return null;
  } catch {
    return `node-pty spawn-helper is not executable beside ${path.relative(nodeModules, selectedDirectory)}/pty.node`;
  }
}

function invalidInstalledArtifact() {
  const lockfile = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  for (const name of directDependencies()) {
    const installedPath = dependencyPackageJson(name);
    if (!existsSync(installedPath)) return `${name} is missing`;
    const expectedVersion = lockfile.packages?.[`node_modules/${name}`]?.version;
    const installedVersion = JSON.parse(readFileSync(installedPath, 'utf8')).version;
    if (expectedVersion && installedVersion !== expectedVersion) {
      return `${name}@${installedVersion ?? 'unknown'} does not match lockfile version ${expectedVersion}`;
    }
  }

  const bins = process.platform === 'win32'
    ? ['electron.cmd', 'next.cmd', 'tsx.cmd']
    : ['electron', 'next', 'tsx'];
  for (const bin of bins) {
    if (!existsSync(path.join(nodeModules, '.bin', bin))) return `node_modules/.bin/${bin} is missing`;
  }
  return invalidNativeArtifact();
}

function fail(reason) {
  console.error(`  Dependency refresh required: ${reason}.`);
  process.exitCode = 1;
}

function check() {
  if (!existsSync(nodeModules)) {
    fail('node_modules is missing');
    return;
  }
  if (!existsSync(stampPath)) {
    fail('the installed dependency state is unverified');
    return;
  }

  let installed;
  try {
    installed = JSON.parse(readFileSync(stampPath, 'utf8'));
  } catch {
    fail('the dependency state stamp is unreadable');
    return;
  }

  const expected = expectedState();
  for (const key of Object.keys(expected)) {
    if (installed[key] !== expected[key]) {
      fail(key === 'manifestHash'
        ? 'package.json or package-lock.json changed'
        : `the install was created for a different ${key}`);
      return;
    }
  }

  const invalid = invalidInstalledArtifact();
  if (invalid) fail(invalid);
}

function write() {
  repairNativeArtifacts();
  const invalid = invalidInstalledArtifact();
  if (invalid) {
    fail(`${invalid} after npm ci`);
    return;
  }

  mkdirSync(nodeModules, { recursive: true });
  const temporaryPath = `${stampPath}.${process.pid}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(expectedState(), null, 2)}\n`);
    rmSync(stampPath, { force: true });
    renameSync(temporaryPath, stampPath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function repair() {
  repairNativeArtifacts();
  const invalid = invalidNativeArtifact();
  if (invalid) fail(invalid);
}

const command = process.argv[2];
if (command === 'check') check();
else if (command === 'write') write();
else if (command === 'repair') repair();
else {
  console.error('Usage: node scripts/dependency-state.mjs <check|write|repair>');
  process.exitCode = 2;
}
