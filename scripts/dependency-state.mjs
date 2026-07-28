#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
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
  return null;
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

const command = process.argv[2];
if (command === 'check') check();
else if (command === 'write') write();
else {
  console.error('Usage: node scripts/dependency-state.mjs <check|write>');
  process.exitCode = 2;
}
