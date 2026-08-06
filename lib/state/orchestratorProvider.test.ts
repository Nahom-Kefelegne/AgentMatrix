/**
 * First tests in the repo.
 *
 *   npx vitest run          — one-shot
 *   npx vitest              — watch mode
 *   npm test                — same as `vitest run`
 *
 * Deliberately dependency-light: `resolveOrchestratorProvider` is pure, so
 * nothing here touches the filesystem, PtyManager, or node-pty.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveOrchestratorProvider,
  ORCHESTRATOR_PROVIDER_PREFERENCE,
  type OrchestratorProvider,
} from './orchestratorProvider';

/** Availability probe backed by a fixed allow-list. */
const availability = (...available: OrchestratorProvider[]) =>
  (provider: OrchestratorProvider) => available.includes(provider);

const NONE = availability();

describe('resolveOrchestratorProvider — auto', () => {
  it('picks the first preference entry when everything is available', () => {
    const resolved = resolveOrchestratorProvider(
      'auto',
      availability('kimi', 'claude', 'copilot'),
    );
    expect(resolved).toBe(ORCHESTRATOR_PROVIDER_PREFERENCE[0]);
  });

  it('skips unavailable providers and takes the next in order', () => {
    // 'kimi' has no provider registered yet — the common case today.
    expect(resolveOrchestratorProvider('auto', availability('claude', 'copilot'))).toBe('claude');
    expect(resolveOrchestratorProvider('auto', availability('copilot'))).toBe('copilot');
  });

  it('resolves the sole installed provider regardless of position', () => {
    expect(resolveOrchestratorProvider('auto', availability('claude'))).toBe('claude');
    expect(resolveOrchestratorProvider('auto', availability('copilot'))).toBe('copilot');
  });

  it('returns null when nothing is available', () => {
    expect(resolveOrchestratorProvider('auto', NONE)).toBeNull();
  });

  it('treats an absent setting as auto', () => {
    expect(resolveOrchestratorProvider(undefined, availability('claude'))).toBe('claude');
    expect(resolveOrchestratorProvider(undefined, NONE)).toBeNull();
  });

  it('honours a caller-supplied preference order', () => {
    const resolved = resolveOrchestratorProvider(
      'auto',
      availability('claude', 'copilot'),
      ['copilot', 'claude'],
    );
    expect(resolved).toBe('copilot');
  });
});

describe('resolveOrchestratorProvider — explicit', () => {
  it('returns the requested provider when it is available', () => {
    expect(resolveOrchestratorProvider('claude', availability('claude', 'copilot'))).toBe('claude');
    expect(resolveOrchestratorProvider('copilot', availability('claude', 'copilot'))).toBe('copilot');
  });

  it('returns null rather than silently substituting another provider', () => {
    // The caller logs and falls back, so the mismatch stays visible.
    expect(resolveOrchestratorProvider('claude', availability('copilot'))).toBeNull();
    expect(resolveOrchestratorProvider('copilot', availability('claude'))).toBeNull();
  });

  it('does not resolve a provider that has no implementation yet', () => {
    expect(resolveOrchestratorProvider('kimi', availability('claude', 'copilot'))).toBeNull();
  });

  it('resolves kimi once its provider becomes available', () => {
    expect(resolveOrchestratorProvider('kimi', availability('kimi'))).toBe('kimi');
  });
});
