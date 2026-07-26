import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { resolve } from 'path';

export interface NavigationCapability {
  sessionId: string;
  capability: string;
  repoIdentity: string;
}

interface RegisteredRoot extends NavigationCapability {
  cwd: string;
  root?: string;
  registeredAt: number;
}

const globalRegistry = globalThis as typeof globalThis & {
  __agentMatrixNavigationRoots?: Map<string, RegisteredRoot>;
};

const roots = globalRegistry.__agentMatrixNavigationRoots
  ?? (globalRegistry.__agentMatrixNavigationRoots = new Map<string, RegisteredRoot>());

function identityFor(path: string): string {
  const normalized = process.platform === 'win32' ? resolve(path).toLocaleLowerCase() : resolve(path);
  return `repo:${createHash('sha256').update(normalized).digest('hex').slice(0, 24)}`;
}

/**
 * Creates the capability passed only through a managed CLI process environment.
 * The token is deliberately never persisted in either CLI's MCP configuration.
 */
export function issueNavigationCapability(sessionId: string, cwd: string): NavigationCapability {
  const existing = roots.get(sessionId);
  if (existing && existing.cwd === cwd) {
    return {
      sessionId,
      capability: existing.capability,
      repoIdentity: existing.repoIdentity,
    };
  }

  const capability = randomBytes(32).toString('base64url');
  const registered: RegisteredRoot = {
    sessionId,
    capability,
    repoIdentity: identityFor(cwd),
    cwd,
    registeredAt: Date.now(),
  };
  roots.set(sessionId, registered);
  return registered;
}

export function registerNavigationRoot(sessionId: string, cwd: string, root: string): void {
  const existing = roots.get(sessionId);
  if (!existing || existing.cwd !== cwd) return;
  existing.root = root;
  existing.repoIdentity = identityFor(root);
  existing.registeredAt = Date.now();
}

export function getRegisteredNavigationRoot(sessionId: string): RegisteredRoot | undefined {
  return roots.get(sessionId);
}

export function verifyNavigationCapability(sessionId: string, capability: string | null | undefined): boolean {
  const registered = roots.get(sessionId);
  if (!registered || !capability) return false;

  const expected = Buffer.from(registered.capability);
  const received = Buffer.from(capability);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function clearNavigationCapability(sessionId: string): void {
  roots.delete(sessionId);
}
