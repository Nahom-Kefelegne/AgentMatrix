/**
 * Tests for the WorkPacket data type and its validator.
 *
 *   npx vitest run          — one-shot
 *   npx vitest              — watch mode
 *   npm test                — same as `vitest run`
 *
 * Deliberately dependency-light, like `lib/state/orchestratorProvider.test.ts`:
 * everything under test is pure, so nothing here touches the filesystem,
 * PtyManager, node-pty, or a real CliProvider. The provider profiles below are
 * hand-written literals that mirror the real flags on ClaudeProvider /
 * CopilotProvider.
 */
import { describe, it, expect } from 'vitest';
import {
  CAPABILITY_FLAGS,
  DEFAULT_PRIORITY,
  DEFAULT_TIMEOUT_MS_BY_KIND,
  DISPATCHABLE_PROVIDERS,
  MAX_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  SESSION_BOUND_KINDS,
  WORK_EFFORTS,
  WORK_KINDS,
  WORK_PRIORITIES,
  capabilityProfile,
  checkProviderEligibility,
  isWorkPacket,
  mustRunInOriginSession,
  requiredCapabilities,
  resolvePriority,
  resolveTimeoutMs,
  validateWorkPacket,
  type ProviderProfile,
  type WorkPacket,
  type WorkPacketIssue,
} from './WorkPacket';

// ─── Helpers ─────────────────────────────────────────────────────────

/** Assert the input validates, and hand back the normalized packet. */
function expectOk(input: unknown): WorkPacket {
  const result = validateWorkPacket(input);
  if (!result.ok) {
    throw new Error(`expected a valid packet, got issues: ${JSON.stringify(result.issues)}`);
  }
  return result.packet;
}

/** Assert the input is rejected, and hand back the issues. */
function expectIssues(input: unknown): WorkPacketIssue[] {
  const result = validateWorkPacket(input);
  if (result.ok) {
    throw new Error(`expected validation to fail, got: ${JSON.stringify(result.packet)}`);
  }
  return result.issues;
}

/** The issue codes reported against one field path. */
const codesAt = (issues: WorkPacketIssue[], path: string) =>
  issues.filter(entry => entry.path === path).map(entry => entry.code);

const paths = (issues: WorkPacketIssue[]) => issues.map(entry => entry.path).sort();

const SESSION_ID = '11111111-2222-3333-4444-555555555555';

// ─── Fixtures: the three real out-of-band consumers ──────────────────

/** SummaryService.requestSummary — bullets about one session's own work. */
const summaryPacket = {
  id: 'wp-summary-1',
  kind: 'summary',
  label: 'Summary',
  instruction:
    'Summarize work done this session in exactly 3 bullet points, 4-5 words each. Each line must start with "- ". Nothing else.',
  origin: { sessionId: SESSION_ID, cwd: '/home/dev/repo' },
  effort: 'low',
  priority: 'low',
  createdAt: 1_700_000_000_000,
};

/** HandoffService.generateHandoffSummary — 90s budget, pinned to the source
 *  session's own CLI because that session is already spawned under it. */
const handoffPacket = {
  id: 'wp-handoff-1',
  kind: 'handoff',
  label: 'Handoff',
  instruction: 'Create a context handoff document for: "auth refactor". Include: decisions, file paths, code patterns, current state, next steps.',
  origin: { sessionId: SESSION_ID },
  constraints: { provider: 'claude' },
  timeoutMs: 90_000,
  priority: 'normal',
};

/** OrchestratorService.queryOrchestrator — no originating session at all. */
const queryPacket = {
  id: 'wp-query-1',
  kind: 'query',
  instruction: 'List the files changed in the last hour under /repo.',
};

/** ResumeModal Deep Session Search — 120s budget, must not run inside a user's
 *  session (it would pollute that conversation), needs out-of-band execution. */
const searchPacket = {
  id: 'wp-search-1',
  kind: 'search',
  label: 'Deep search',
  instruction: 'Find coding sessions whose transcripts mention: "socket reconnect". Output ONLY UUIDs, one per line, max 10.',
  constraints: { requires: ['supportsAcp'] },
  timeoutMs: 120_000,
  priority: 'high',
  effort: 'low',
};

// ─── Provider profiles (mirroring the real implementations) ──────────

const CLAUDE: ProviderProfile = {
  type: 'claude',
  supportsMcp: true,
  supportsFork: true,
  supportsContextTracking: true,
  supportsSubagents: true,
  supportsAcp: false,
};

const COPILOT: ProviderProfile = {
  type: 'copilot',
  supportsMcp: false,
  supportsFork: false,
  supportsContextTracking: true,
  supportsSubagents: true,
  supportsAcp: true,
};

const KIMI: ProviderProfile = {
  type: 'kimi',
  supportsMcp: false,
  supportsFork: false,
  supportsContextTracking: false,
  supportsSubagents: false,
  supportsAcp: true,
};

// ─── Valid packets ───────────────────────────────────────────────────

describe('validateWorkPacket — the packets the app actually issues', () => {
  it('accepts a summary packet', () => {
    const packet = expectOk(summaryPacket);
    expect(packet.kind).toBe('summary');
    expect(packet.origin?.sessionId).toBe(SESSION_ID);
    expect(packet.origin?.cwd).toBe('/home/dev/repo');
    expect(packet.effort).toBe('low');
  });

  it('accepts a handoff packet with a pinned provider', () => {
    const packet = expectOk(handoffPacket);
    expect(packet.kind).toBe('handoff');
    expect(packet.constraints?.provider).toBe('claude');
    expect(packet.timeoutMs).toBe(90_000);
  });

  it('accepts an orchestrator query with no origin session', () => {
    const packet = expectOk(queryPacket);
    expect(packet.kind).toBe('query');
    expect(packet.origin).toBeUndefined();
    expect(packet.constraints).toBeUndefined();
  });

  it('accepts a deep-search packet with capability requirements', () => {
    const packet = expectOk(searchPacket);
    expect(packet.kind).toBe('search');
    expect(packet.constraints?.requires).toEqual(['supportsAcp']);
  });

  it('covers every declared kind with at least one fixture', () => {
    const kinds = [summaryPacket, handoffPacket, queryPacket, searchPacket].map(p => expectOk(p).kind);
    expect([...kinds].sort()).toEqual([...WORK_KINDS].sort());
  });

  it('accepts the minimum viable packet', () => {
    const packet = expectOk({ id: 'a', kind: 'query', instruction: 'go' });
    expect(packet).toEqual({ id: 'a', kind: 'query', instruction: 'go' });
  });

  it('survives a JSON round trip unchanged (it crosses the socket/IPC boundary)', () => {
    for (const fixture of [summaryPacket, handoffPacket, queryPacket, searchPacket]) {
      const packet = expectOk(fixture);
      expect(expectOk(JSON.parse(JSON.stringify(packet)))).toEqual(packet);
    }
  });

  it('is idempotent — validating a normalized packet is a no-op', () => {
    const once = expectOk({ ...summaryPacket, id: '  wp-summary-1  ' });
    expect(expectOk(once)).toEqual(once);
  });
});

// ─── Normalization ───────────────────────────────────────────────────

describe('validateWorkPacket — normalization', () => {
  it('trims surrounding whitespace on string fields', () => {
    const packet = expectOk({
      id: '  wp-1  ',
      kind: 'query',
      instruction: '\n  do the thing  \n',
      label: ' Deep search ',
    });
    expect(packet.id).toBe('wp-1');
    expect(packet.instruction).toBe('do the thing');
    expect(packet.label).toBe('Deep search');
  });

  it('preserves interior newlines in multi-line instructions', () => {
    const packet = expectOk({ id: 'a', kind: 'query', instruction: 'line one\nline two' });
    expect(packet.instruction).toBe('line one\nline two');
  });

  it('collapses duplicate capability flags, preserving first-seen order', () => {
    const packet = expectOk({
      ...queryPacket,
      constraints: { requires: ['supportsAcp', 'supportsMcp', 'supportsAcp'] },
    });
    expect(packet.constraints?.requires).toEqual(['supportsAcp', 'supportsMcp']);
  });

  it('drops an empty constraints block rather than carrying a meaningless one', () => {
    expect(expectOk({ ...queryPacket, constraints: {} }).constraints).toBeUndefined();
  });

  it('keeps an explicitly empty requires list (it is a stated "no requirements")', () => {
    expect(expectOk({ ...queryPacket, constraints: { requires: [] } }).constraints).toEqual({ requires: [] });
  });

  it('does not fill in defaults — an absent timeout stays absent', () => {
    // "the caller asked for 45s" and "nobody asked" must stay distinguishable.
    const packet = expectOk(queryPacket);
    expect(packet.timeoutMs).toBeUndefined();
    expect(packet.priority).toBeUndefined();
    expect(resolveTimeoutMs(packet)).toBe(DEFAULT_TIMEOUT_MS_BY_KIND.query);
  });

  it('ignores unknown properties so a newer client can talk to an older host', () => {
    const packet = expectOk({ ...queryPacket, somethingFromTheFuture: { nested: true } });
    expect(packet).not.toHaveProperty('somethingFromTheFuture');
    expect(packet.id).toBe('wp-query-1');
  });
});

// ─── Rejection: shape ────────────────────────────────────────────────

describe('validateWorkPacket — non-object input', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'summarize this'],
    ['a number', 42],
    ['a boolean', true],
    ['an array', [{ id: 'a', kind: 'query', instruction: 'go' }]],
  ])('rejects %s', (_label, input) => {
    const issues = expectIssues(input);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('not_an_object');
    expect(issues[0].path).toBe('');
  });
});

// ─── Rejection: required fields ──────────────────────────────────────

describe('validateWorkPacket — id', () => {
  it('rejects a missing id', () => {
    expect(codesAt(expectIssues({ kind: 'query', instruction: 'go' }), 'id')).toEqual(['missing']);
  });

  it('rejects a non-string id', () => {
    expect(codesAt(expectIssues({ ...queryPacket, id: 7 }), 'id')).toEqual(['wrong_type']);
  });

  it('rejects an empty or whitespace-only id', () => {
    expect(codesAt(expectIssues({ ...queryPacket, id: '' }), 'id')).toEqual(['empty']);
    expect(codesAt(expectIssues({ ...queryPacket, id: '   ' }), 'id')).toEqual(['empty']);
  });
});

describe('validateWorkPacket — kind', () => {
  it('reports a missing kind as missing, not as a bad value', () => {
    expect(codesAt(expectIssues({ id: 'a', instruction: 'go' }), 'kind')).toEqual(['missing']);
  });

  it('rejects an unknown kind and names the alternatives', () => {
    const issues = expectIssues({ ...queryPacket, kind: 'sumary' });
    expect(codesAt(issues, 'kind')).toEqual(['unknown_value']);
    expect(issues[0].message).toContain('summary');
  });

  it('rejects a non-string kind', () => {
    expect(codesAt(expectIssues({ ...queryPacket, kind: 3 }), 'kind')).toEqual(['wrong_type']);
  });
});

describe('validateWorkPacket — instruction', () => {
  it('rejects a missing instruction', () => {
    expect(codesAt(expectIssues({ id: 'a', kind: 'query' }), 'instruction')).toEqual(['missing']);
  });

  it('rejects a non-string instruction', () => {
    expect(codesAt(expectIssues({ ...queryPacket, instruction: { text: 'go' } }), 'instruction')).toEqual(['wrong_type']);
  });

  it('rejects an instruction that is only whitespace', () => {
    expect(codesAt(expectIssues({ ...queryPacket, instruction: '  \n ' }), 'instruction')).toEqual(['empty']);
  });
});

describe('validateWorkPacket — label', () => {
  it('rejects a non-string label', () => {
    expect(codesAt(expectIssues({ ...queryPacket, label: 12 }), 'label')).toEqual(['wrong_type']);
  });

  it('rejects an empty label (an empty console badge is worse than none)', () => {
    expect(codesAt(expectIssues({ ...queryPacket, label: '  ' }), 'label')).toEqual(['empty']);
  });
});

// ─── Rejection: origin ───────────────────────────────────────────────

describe('validateWorkPacket — origin', () => {
  it('rejects a non-object origin', () => {
    expect(codesAt(expectIssues({ ...queryPacket, origin: SESSION_ID }), 'origin')).toEqual(['wrong_type']);
    expect(codesAt(expectIssues({ ...queryPacket, origin: [SESSION_ID] }), 'origin')).toEqual(['wrong_type']);
  });

  it('rejects an origin with no sessionId', () => {
    expect(codesAt(expectIssues({ ...queryPacket, origin: { cwd: '/repo' } }), 'origin.sessionId')).toEqual(['missing']);
  });

  it('rejects an empty sessionId', () => {
    expect(codesAt(expectIssues({ ...queryPacket, origin: { sessionId: '' } }), 'origin.sessionId')).toEqual(['empty']);
  });

  it('rejects a non-string cwd', () => {
    const issues = expectIssues({ ...queryPacket, origin: { sessionId: SESSION_ID, cwd: 5 } });
    expect(codesAt(issues, 'origin.cwd')).toEqual(['wrong_type']);
  });

  it('accepts an origin without a cwd (the runner can recover it)', () => {
    expect(expectOk({ ...queryPacket, origin: { sessionId: SESSION_ID } }).origin).toEqual({ sessionId: SESSION_ID });
  });
});

// ─── Rejection: cross-field consistency ──────────────────────────────

describe('validateWorkPacket — session-bound kinds', () => {
  it.each([...SESSION_BOUND_KINDS])('rejects a %s packet with no origin session', kind => {
    const issues = expectIssues({ id: 'a', kind, instruction: 'go' });
    expect(codesAt(issues, 'origin.sessionId')).toEqual(['inconsistent']);
    expect(issues[0].message).toContain(kind);
  });

  it('allows query and search with no origin session', () => {
    expect(expectOk({ id: 'a', kind: 'query', instruction: 'go' }).origin).toBeUndefined();
    expect(expectOk({ id: 'b', kind: 'search', instruction: 'go' }).origin).toBeUndefined();
  });

  it('rejects requiresOriginSession: true without an origin session', () => {
    const issues = expectIssues({ ...queryPacket, requiresOriginSession: true });
    expect(codesAt(issues, 'origin.sessionId')).toEqual(['inconsistent']);
  });

  it('accepts requiresOriginSession: true when an origin session is present', () => {
    const packet = expectOk({ ...queryPacket, requiresOriginSession: true, origin: { sessionId: SESSION_ID } });
    expect(packet.requiresOriginSession).toBe(true);
  });

  it('accepts requiresOriginSession: false with no origin at all', () => {
    expect(expectOk({ ...queryPacket, requiresOriginSession: false }).requiresOriginSession).toBe(false);
  });

  it('rejects a non-boolean requiresOriginSession', () => {
    expect(codesAt(expectIssues({ ...queryPacket, requiresOriginSession: 'yes' }), 'requiresOriginSession'))
      .toEqual(['wrong_type']);
  });
});

// ─── Rejection: constraints ──────────────────────────────────────────

describe('validateWorkPacket — constraints', () => {
  it('rejects a non-object constraints block', () => {
    expect(codesAt(expectIssues({ ...queryPacket, constraints: 'claude' }), 'constraints')).toEqual(['wrong_type']);
    expect(codesAt(expectIssues({ ...queryPacket, constraints: ['claude'] }), 'constraints')).toEqual(['wrong_type']);
  });

  it('rejects a provider that has no implementation registered', () => {
    // A packet may only pin a provider `getProvider` can instantiate.
    const issues = expectIssues({ ...queryPacket, constraints: { provider: 'gemini' } });
    expect(codesAt(issues, 'constraints.provider')).toEqual(['unknown_value']);
  });

  it("rejects 'auto' — a packet states requirements, it does not choose", () => {
    // 'auto' is a valid OrchestratorProviderSetting, but selection belongs to
    // resolveOrchestratorProvider, not to the packet.
    expect(codesAt(expectIssues({ ...queryPacket, constraints: { provider: 'auto' } }), 'constraints.provider'))
      .toEqual(['unknown_value']);
  });

  it.each([...DISPATCHABLE_PROVIDERS])('accepts %s as a pinned provider', provider => {
    expect(expectOk({ ...queryPacket, constraints: { provider } }).constraints?.provider).toBe(provider);
  });

  it('rejects a non-array requires list', () => {
    expect(codesAt(expectIssues({ ...queryPacket, constraints: { requires: 'supportsAcp' } }), 'constraints.requires'))
      .toEqual(['wrong_type']);
  });

  it('rejects an unknown capability flag and points at the offending index', () => {
    const issues = expectIssues({
      ...queryPacket,
      constraints: { requires: ['supportsAcp', 'supportsTelepathy'] },
    });
    expect(codesAt(issues, 'constraints.requires[1]')).toEqual(['unknown_value']);
    expect(codesAt(issues, 'constraints.requires[0]')).toEqual([]);
  });

  it('rejects a non-string entry in requires', () => {
    expect(codesAt(expectIssues({ ...queryPacket, constraints: { requires: [null] } }), 'constraints.requires[0]'))
      .toEqual(['wrong_type']);
  });

  it.each([...CAPABILITY_FLAGS])('accepts %s as a requirement', flag => {
    expect(expectOk({ ...queryPacket, constraints: { requires: [flag] } }).constraints?.requires).toEqual([flag]);
  });
});

// ─── Rejection / boundaries: numbers and enums ───────────────────────

describe('validateWorkPacket — timeoutMs', () => {
  it.each([
    ['a string', '45000'],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['null', null],
  ])('rejects %s', (_label, value) => {
    expect(codesAt(expectIssues({ ...queryPacket, timeoutMs: value }), 'timeoutMs')).toEqual(['wrong_type']);
  });

  it('rejects a fractional millisecond count', () => {
    expect(codesAt(expectIssues({ ...queryPacket, timeoutMs: 1500.5 }), 'timeoutMs')).toEqual(['wrong_type']);
  });

  it('rejects values outside the supported range', () => {
    expect(codesAt(expectIssues({ ...queryPacket, timeoutMs: 0 }), 'timeoutMs')).toEqual(['out_of_range']);
    expect(codesAt(expectIssues({ ...queryPacket, timeoutMs: -1 }), 'timeoutMs')).toEqual(['out_of_range']);
    expect(codesAt(expectIssues({ ...queryPacket, timeoutMs: MIN_TIMEOUT_MS - 1 }), 'timeoutMs')).toEqual(['out_of_range']);
    expect(codesAt(expectIssues({ ...queryPacket, timeoutMs: MAX_TIMEOUT_MS + 1 }), 'timeoutMs')).toEqual(['out_of_range']);
  });

  it('accepts both bounds inclusively', () => {
    expect(expectOk({ ...queryPacket, timeoutMs: MIN_TIMEOUT_MS }).timeoutMs).toBe(MIN_TIMEOUT_MS);
    expect(expectOk({ ...queryPacket, timeoutMs: MAX_TIMEOUT_MS }).timeoutMs).toBe(MAX_TIMEOUT_MS);
  });

  it('accepts every timeout the app uses today', () => {
    for (const value of Object.values(DEFAULT_TIMEOUT_MS_BY_KIND)) {
      expect(expectOk({ ...queryPacket, timeoutMs: value }).timeoutMs).toBe(value);
    }
  });
});

describe('validateWorkPacket — createdAt', () => {
  it('rejects a non-numeric timestamp', () => {
    expect(codesAt(expectIssues({ ...queryPacket, createdAt: '2026-01-01' }), 'createdAt')).toEqual(['wrong_type']);
    expect(codesAt(expectIssues({ ...queryPacket, createdAt: Number.NaN }), 'createdAt')).toEqual(['wrong_type']);
  });

  it('rejects a negative timestamp', () => {
    expect(codesAt(expectIssues({ ...queryPacket, createdAt: -1 }), 'createdAt')).toEqual(['out_of_range']);
  });

  it('accepts epoch zero', () => {
    expect(expectOk({ ...queryPacket, createdAt: 0 }).createdAt).toBe(0);
  });
});

describe('validateWorkPacket — priority and effort', () => {
  it.each([...WORK_PRIORITIES])('accepts priority %s', priority => {
    expect(expectOk({ ...queryPacket, priority }).priority).toBe(priority);
  });

  it.each([...WORK_EFFORTS])('accepts effort %s', effort => {
    expect(expectOk({ ...queryPacket, effort }).effort).toBe(effort);
  });

  it('rejects an unknown priority', () => {
    expect(codesAt(expectIssues({ ...queryPacket, priority: 'urgent' }), 'priority')).toEqual(['unknown_value']);
  });

  it('rejects an unknown effort', () => {
    expect(codesAt(expectIssues({ ...queryPacket, effort: 'maximum' }), 'effort')).toEqual(['unknown_value']);
  });

  it("rejects EFFORT_LEVELS' empty-string 'Default' — absence means default here", () => {
    expect(codesAt(expectIssues({ ...queryPacket, effort: '' }), 'effort')).toEqual(['unknown_value']);
  });
});

// ─── Reporting behavior ──────────────────────────────────────────────

describe('validateWorkPacket — issue reporting', () => {
  it('collects every problem in one pass instead of stopping at the first', () => {
    const issues = expectIssues({
      kind: 'transmute',
      instruction: '',
      origin: { sessionId: '' },
      constraints: { provider: 'gemini', requires: ['supportsWishes'] },
      timeoutMs: -5,
      priority: 'urgent',
    });
    expect(paths(issues)).toEqual([
      'constraints.provider',
      'constraints.requires[0]',
      'id',
      'instruction',
      'kind',
      'origin.sessionId',
      'priority',
      'timeoutMs',
    ]);
  });

  it('always produces at least one issue when it reports failure', () => {
    expect(expectIssues({}).length).toBeGreaterThan(0);
  });

  it('writes messages that name the field and the received value', () => {
    const issues = expectIssues({ ...queryPacket, kind: 'sumary' });
    expect(issues[0].message).toContain('kind');
    expect(issues[0].message).toContain('"sumary"');
  });
});

// ─── isWorkPacket ────────────────────────────────────────────────────

describe('isWorkPacket', () => {
  it('agrees with validateWorkPacket', () => {
    expect(isWorkPacket(summaryPacket)).toBe(true);
    expect(isWorkPacket(handoffPacket)).toBe(true);
    expect(isWorkPacket(queryPacket)).toBe(true);
    expect(isWorkPacket(searchPacket)).toBe(true);
    expect(isWorkPacket({ id: 'a', kind: 'summary', instruction: 'go' })).toBe(false);
    expect(isWorkPacket(null)).toBe(false);
    expect(isWorkPacket('go')).toBe(false);
  });

  it('narrows the type for the caller', () => {
    const unknownInput: unknown = queryPacket;
    if (isWorkPacket(unknownInput)) {
      expect(unknownInput.kind).toBe('query');
    } else {
      throw new Error('expected the guard to pass');
    }
  });
});

// ─── Defaulting helpers ──────────────────────────────────────────────

describe('resolveTimeoutMs', () => {
  it('prefers an explicit budget', () => {
    expect(resolveTimeoutMs(expectOk(handoffPacket))).toBe(90_000);
    expect(resolveTimeoutMs(expectOk(searchPacket))).toBe(120_000);
  });

  it.each([...WORK_KINDS])('falls back to the %s default', kind => {
    const base = { id: 'a', kind, instruction: 'go', origin: { sessionId: SESSION_ID } };
    expect(resolveTimeoutMs(expectOk(base))).toBe(DEFAULT_TIMEOUT_MS_BY_KIND[kind]);
  });

  it('gives every kind a default inside the accepted range', () => {
    for (const value of Object.values(DEFAULT_TIMEOUT_MS_BY_KIND)) {
      expect(value).toBeGreaterThanOrEqual(MIN_TIMEOUT_MS);
      expect(value).toBeLessThanOrEqual(MAX_TIMEOUT_MS);
    }
  });
});

describe('resolvePriority', () => {
  it('prefers an explicit priority', () => {
    expect(resolvePriority(expectOk(searchPacket))).toBe('high');
    expect(resolvePriority(expectOk(summaryPacket))).toBe('low');
  });

  it('defaults to normal', () => {
    expect(resolvePriority(expectOk(queryPacket))).toBe(DEFAULT_PRIORITY);
    expect(DEFAULT_PRIORITY).toBe('normal');
  });
});

describe('mustRunInOriginSession', () => {
  it('is true by default for kinds that read the session context', () => {
    expect(mustRunInOriginSession(expectOk(summaryPacket))).toBe(true);
    expect(mustRunInOriginSession(expectOk(handoffPacket))).toBe(true);
  });

  it('is false by default for free-floating work', () => {
    expect(mustRunInOriginSession(expectOk(queryPacket))).toBe(false);
    expect(mustRunInOriginSession(expectOk(searchPacket))).toBe(false);
  });

  it('honours an explicit override in both directions', () => {
    // A query that asks one session about its own edits must be pinned to it…
    const pinnedQuery = expectOk({ ...queryPacket, requiresOriginSession: true, origin: { sessionId: SESSION_ID } });
    expect(mustRunInOriginSession(pinnedQuery)).toBe(true);

    // …and a summary the author knows can be produced from a transcript need not be.
    const looseSummary = expectOk({ ...summaryPacket, requiresOriginSession: false });
    expect(mustRunInOriginSession(looseSummary)).toBe(false);
  });
});

describe('requiredCapabilities', () => {
  it('returns the declared flags', () => {
    expect(requiredCapabilities(expectOk(searchPacket))).toEqual(['supportsAcp']);
  });

  it('returns an empty array when nothing is declared, never undefined', () => {
    expect(requiredCapabilities(expectOk(queryPacket))).toEqual([]);
    expect(requiredCapabilities(expectOk({ ...queryPacket, constraints: { provider: 'claude' } }))).toEqual([]);
  });
});

// ─── Provider fit ────────────────────────────────────────────────────

describe('capabilityProfile', () => {
  it('projects a provider-shaped object down to its serializable flags', () => {
    const provider = {
      type: 'copilot' as const,
      supportsMcp: false,
      supportsFork: false,
      supportsContextTracking: true,
      supportsSubagents: true,
      supportsAcp: true,
      // Extra members a real CliProvider carries; none should survive.
      displayName: 'Copilot CLI',
      configDir: '/home/dev/.copilot',
    };
    const profile = capabilityProfile(provider);
    expect(profile).toEqual(COPILOT);
    expect(Object.keys(profile).sort()).toEqual(['type', ...CAPABILITY_FLAGS].sort());
  });

  it('produces something JSON-serializable', () => {
    expect(JSON.parse(JSON.stringify(capabilityProfile(CLAUDE)))).toEqual(CLAUDE);
  });
});

describe('checkProviderEligibility', () => {
  it('accepts a provider that meets every requirement', () => {
    const result = checkProviderEligibility(expectOk(searchPacket), COPILOT);
    expect(result).toEqual({ eligible: true, missingCapabilities: [], pinnedProviderMismatch: false });
  });

  it('reports exactly which capabilities are missing', () => {
    // Claude has no ACP mode today, which is why captureQuery falls back to the
    // PTY injector for it.
    const result = checkProviderEligibility(expectOk(searchPacket), CLAUDE);
    expect(result.eligible).toBe(false);
    expect(result.missingCapabilities).toEqual(['supportsAcp']);
    expect(result.pinnedProviderMismatch).toBe(false);
  });

  it('lists several missing capabilities at once', () => {
    const packet = expectOk({ ...queryPacket, constraints: { requires: ['supportsMcp', 'supportsFork', 'supportsSubagents'] } });
    expect(checkProviderEligibility(packet, COPILOT).missingCapabilities).toEqual(['supportsMcp', 'supportsFork']);
    expect(checkProviderEligibility(packet, CLAUDE).eligible).toBe(true);
  });

  it('rejects a provider the packet is not pinned to', () => {
    const packet = expectOk(handoffPacket); // pinned to claude
    const result = checkProviderEligibility(packet, COPILOT);
    expect(result.eligible).toBe(false);
    expect(result.pinnedProviderMismatch).toBe(true);
    expect(result.missingCapabilities).toEqual([]);
  });

  it('accepts the pinned provider itself', () => {
    expect(checkProviderEligibility(expectOk(handoffPacket), CLAUDE).eligible).toBe(true);
  });

  it('reports a pin mismatch and missing capabilities independently', () => {
    const packet = expectOk({ ...queryPacket, constraints: { provider: 'claude', requires: ['supportsAcp'] } });
    const result = checkProviderEligibility(packet, COPILOT);
    expect(result).toEqual({ eligible: false, missingCapabilities: [], pinnedProviderMismatch: true });
    // Claude satisfies the pin but not the capability.
    expect(checkProviderEligibility(packet, CLAUDE)).toEqual({
      eligible: false,
      missingCapabilities: ['supportsAcp'],
      pinnedProviderMismatch: false,
    });
  });

  it('accepts any provider for an unconstrained packet', () => {
    const packet = expectOk(queryPacket);
    for (const profile of [CLAUDE, COPILOT, KIMI]) {
      expect(checkProviderEligibility(packet, profile).eligible).toBe(true);
    }
  });

  it('admits a newly registered provider that meets the bar', () => {
    // Kimi has no MCP, fork, context tracking or subagents, but it does have
    // ACP — so it qualifies for out-of-band work and nothing else.
    const packet = expectOk(searchPacket);
    expect(checkProviderEligibility(packet, KIMI).eligible).toBe(true);

    const needsSubagents = expectOk({ ...queryPacket, constraints: { requires: ['supportsSubagents'] } });
    expect(checkProviderEligibility(needsSubagents, KIMI).missingCapabilities).toEqual(['supportsSubagents']);
  });
});

// ─── Constant tables ─────────────────────────────────────────────────

describe('constant tables', () => {
  it('keeps CAPABILITY_FLAGS in sync with a real provider shape', () => {
    // If CliProvider gains a supports* flag, the module-level drift guard fails
    // to compile; this asserts the runtime list matches the profiles too.
    for (const profile of [CLAUDE, COPILOT, KIMI]) {
      expect(Object.keys(profile).filter(key => key !== 'type').sort()).toEqual([...CAPABILITY_FLAGS].sort());
    }
  });

  it('has a default timeout for every kind', () => {
    expect(Object.keys(DEFAULT_TIMEOUT_MS_BY_KIND).sort()).toEqual([...WORK_KINDS].sort());
  });

  it('declares session-bound kinds as a subset of the kinds', () => {
    for (const kind of SESSION_BOUND_KINDS) expect(WORK_KINDS).toContain(kind);
  });

  it('lists only registered providers as pinnable', () => {
    // Mirrors the `getOrCreateProvider` switch in lib/cli/index.ts.
    expect([...DISPATCHABLE_PROVIDERS].sort()).toEqual(['claude', 'copilot', 'kimi']);
  });
});
