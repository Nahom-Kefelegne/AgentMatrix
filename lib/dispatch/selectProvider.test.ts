/**
 * Tests for the dispatch selection policy.
 *
 *   npx vitest run          — one-shot
 *   npx vitest              — watch mode
 *   npm test                — same as `vitest run`
 *
 * Deliberately dependency-light, like `lib/dispatch/WorkPacket.test.ts` and
 * `lib/state/orchestratorProvider.test.ts`: `selectProvider` is pure and takes
 * availability as an injected probe, so nothing here touches the filesystem,
 * PtyManager, node-pty, or a real CliProvider. The provider profiles below are
 * hand-written literals mirroring the real flags on ClaudeProvider /
 * CopilotProvider / KimiProvider.
 */
import { describe, it, expect } from 'vitest';
import type { CliType } from '../cli/CliProvider';
import { ORCHESTRATOR_PROVIDER_PREFERENCE } from '../state/orchestratorProvider';
import {
  DISPATCH_FAILURE_TO_WORK_FAILURE,
  describeDispatchDecision,
  selectProvider,
  type DispatchDecision,
  type DispatchFailure,
  type DispatchFailureReason,
  type DispatchSelection,
} from './selectProvider';
import type { ProviderProfile, WorkPacket } from './WorkPacket';

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

/** Kimi declares ACP from its docs; the binary is not installed here, which is
 *  why availability — not the flag — is what keeps work away from it. */
const KIMI: ProviderProfile = {
  type: 'kimi',
  supportsMcp: false,
  supportsFork: false,
  supportsContextTracking: false,
  supportsSubagents: false,
  supportsAcp: true,
};

const ALL_PROFILES = [CLAUDE, COPILOT, KIMI];

// ─── Helpers ─────────────────────────────────────────────────────────

/** Availability probe backed by a fixed allow-list, as in orchestratorProvider.test.ts. */
const availability = (...available: CliType[]) =>
  (provider: CliType) => available.includes(provider);

const EVERYTHING = availability('claude', 'copilot', 'kimi');
const NOTHING = availability();
/** This machine today: Claude and Copilot installed, Kimi not. */
const THIS_MACHINE = availability('claude', 'copilot');

function expectSelected(decision: DispatchDecision): DispatchSelection {
  if (!decision.selected) {
    throw new Error(`expected a selection, got: ${describeDispatchDecision(decision)}`);
  }
  return decision;
}

function expectFailed(decision: DispatchDecision): DispatchFailure {
  if (decision.selected) {
    throw new Error(`expected no selection, got: ${describeDispatchDecision(decision)}`);
  }
  return decision;
}

/** The rejection recorded against one provider. */
const rejectionFor = (decision: DispatchDecision, provider: CliType) =>
  decision.rejected.find(entry => entry.provider === provider);

const SESSION_ID = '11111111-2222-3333-4444-555555555555';

// ─── Fixtures: the four kinds the app actually issues ────────────────

/** SummaryService.requestSummary — session-bound, no pin. */
const summaryPacket: WorkPacket = {
  id: 'wp-summary-1',
  kind: 'summary',
  label: 'Summary',
  instruction: 'Summarize work done this session in exactly 3 bullet points.',
  origin: { sessionId: SESSION_ID, cwd: '/home/dev/repo' },
  effort: 'low',
  priority: 'low',
};

/** HandoffService.generateHandoffSummary — session-bound *and* pinned. */
const handoffPacket: WorkPacket = {
  id: 'wp-handoff-1',
  kind: 'handoff',
  label: 'Handoff',
  instruction: 'Create a context handoff document for: "auth refactor".',
  origin: { sessionId: SESSION_ID },
  constraints: { provider: 'claude' },
  timeoutMs: 90_000,
};

/** OrchestratorService.queryOrchestrator — free to run anywhere. */
const queryPacket: WorkPacket = {
  id: 'wp-query-1',
  kind: 'query',
  instruction: 'List the files changed in the last hour under /repo.',
};

/** ResumeModal Deep Session Search — capability-gated, not session-bound. */
const searchPacket: WorkPacket = {
  id: 'wp-search-1',
  kind: 'search',
  label: 'Deep search',
  instruction: 'Find coding sessions whose transcripts mention: "socket reconnect".',
  constraints: { requires: ['supportsAcp'] },
  timeoutMs: 120_000,
  priority: 'high',
};

// ─── Unbound work: preference-order ranking ──────────────────────────

describe('selectProvider — free-floating work ranks by preference', () => {
  it('picks the head of the preference order when everything is installed', () => {
    const decision = expectSelected(selectProvider(queryPacket, {
      candidates: ALL_PROFILES,
      isAvailable: EVERYTHING,
    }));
    expect(decision.provider).toBe(ORCHESTRATOR_PROVIDER_PREFERENCE[0]);
    expect(decision.provider).toBe('kimi');
    expect(decision.reason).toBe('preferred');
    expect(decision.rejected).toEqual([]);
  });

  it('skips unavailable providers and takes the next in order', () => {
    const decision = expectSelected(selectProvider(queryPacket, {
      candidates: ALL_PROFILES,
      isAvailable: THIS_MACHINE,
    }));
    expect(decision.provider).toBe('claude');
    expect(decision.reason).toBe('preferred');
    // Kimi is rejected for the honest reason: not installed, not incapable.
    expect(rejectionFor(decision, 'kimi')).toMatchObject({
      reason: 'unavailable',
      available: false,
      missingCapabilities: [],
    });
  });

  it('reports the losers as ranked fallbacks, not rejections', () => {
    const decision = expectSelected(selectProvider(queryPacket, {
      candidates: ALL_PROFILES,
      isAvailable: THIS_MACHINE,
    }));
    expect(decision.alternatives).toEqual(['copilot']);
    expect(decision.rejected.map(entry => entry.provider)).toEqual(['kimi']);
  });

  it('honours a caller-supplied preference order', () => {
    const decision = expectSelected(selectProvider(queryPacket, {
      candidates: [CLAUDE, COPILOT],
      isAvailable: THIS_MACHINE,
      preference: ['copilot', 'claude'],
    }));
    expect(decision.provider).toBe('copilot');
    expect(decision.alternatives).toEqual(['claude']);
  });

  it('selects the sole eligible provider regardless of its rank', () => {
    const decision = expectSelected(selectProvider(queryPacket, {
      candidates: ALL_PROFILES,
      isAvailable: availability('copilot'),
    }));
    expect(decision.provider).toBe('copilot');
    expect(decision.alternatives).toEqual([]);
  });
});

// ─── Capability gating ───────────────────────────────────────────────

describe('selectProvider — capability-gated work', () => {
  it('routes ACP-requiring work to the only installed provider that has ACP', () => {
    const decision = expectSelected(selectProvider(searchPacket, {
      candidates: ALL_PROFILES,
      isAvailable: THIS_MACHINE,
    }));
    expect(decision.provider).toBe('copilot');
    expect(decision.reason).toBe('preferred');
  });

  it('never routes to a provider that cannot do the work, and says which flag is missing', () => {
    const decision = selectProvider(searchPacket, {
      candidates: ALL_PROFILES,
      isAvailable: THIS_MACHINE,
    });
    // Claude has no ACP at all — a capability failure, permanent.
    expect(rejectionFor(decision, 'claude')).toMatchObject({
      reason: 'missing_capabilities',
      available: true,
      missingCapabilities: ['supportsAcp'],
    });
    // Kimi declares ACP but is not installed — an availability failure.
    expect(rejectionFor(decision, 'kimi')).toMatchObject({
      reason: 'unavailable',
      available: false,
      missingCapabilities: [],
    });
  });

  it('prefers Kimi for ACP work once Kimi is actually installed', () => {
    const decision = expectSelected(selectProvider(searchPacket, {
      candidates: ALL_PROFILES,
      isAvailable: EVERYTHING,
    }));
    expect(decision.provider).toBe('kimi');
    expect(decision.alternatives).toEqual(['copilot']);
  });

  it('reports none_eligible when no provider has every required flag', () => {
    const impossible: WorkPacket = {
      ...queryPacket,
      constraints: { requires: ['supportsMcp', 'supportsAcp'] },
    };
    const decision = expectFailed(selectProvider(impossible, {
      candidates: ALL_PROFILES,
      isAvailable: EVERYTHING,
    }));
    expect(decision.reason).toBe('none_eligible');
    expect(decision.failure).toBe('no_provider');
    expect(decision.rejected).toHaveLength(3);
    expect(rejectionFor(decision, 'claude')?.missingCapabilities).toEqual(['supportsAcp']);
    expect(rejectionFor(decision, 'copilot')?.missingCapabilities).toEqual(['supportsMcp']);
    expect(rejectionFor(decision, 'kimi')?.missingCapabilities).toEqual(['supportsMcp']);
  });

  it('adds no implicit requirements of its own — an unconstrained packet takes anyone', () => {
    const decision = expectSelected(selectProvider(queryPacket, {
      candidates: [CLAUDE],
      isAvailable: THIS_MACHINE,
    }));
    // Claude has no ACP; out-of-band work still runs there via the PTY injector.
    expect(decision.provider).toBe('claude');
  });
});

// ─── Pinned providers ────────────────────────────────────────────────

describe('selectProvider — pinned provider', () => {
  it('honours a pin that qualifies, over a higher-preference provider', () => {
    const pinned: WorkPacket = { ...queryPacket, constraints: { provider: 'copilot' } };
    const decision = expectSelected(selectProvider(pinned, {
      candidates: ALL_PROFILES,
      isAvailable: EVERYTHING,
    }));
    expect(decision.provider).toBe('copilot');
    expect(decision.reason).toBe('pinned');
    expect(decision.alternatives).toEqual([]);
    expect(decision.rejected.map(entry => entry.reason))
      .toEqual(['pinned_provider_mismatch', 'pinned_provider_mismatch']);
  });

  it('fails rather than substituting when the pinned provider is not installed', () => {
    const pinned: WorkPacket = { ...queryPacket, constraints: { provider: 'kimi' } };
    const decision = expectFailed(selectProvider(pinned, {
      candidates: ALL_PROFILES,
      isAvailable: THIS_MACHINE,
    }));
    expect(decision.reason).toBe('pinned_provider_unavailable');
    expect(decision.failure).toBe('no_provider');
    expect(decision.detail).toContain('kimi');
  });

  it('fails when the pinned provider is installed but lacks a required flag', () => {
    const pinned: WorkPacket = {
      ...searchPacket,
      constraints: { provider: 'claude', requires: ['supportsAcp'] },
    };
    const decision = expectFailed(selectProvider(pinned, {
      candidates: ALL_PROFILES,
      isAvailable: EVERYTHING,
    }));
    expect(decision.reason).toBe('pinned_provider_ineligible');
    expect(decision.detail).toContain('supportsAcp');
  });

  it('distinguishes a pin that was never offered as a candidate', () => {
    const pinned: WorkPacket = { ...queryPacket, constraints: { provider: 'kimi' } };
    const decision = expectFailed(selectProvider(pinned, {
      candidates: [CLAUDE, COPILOT],
      isAvailable: EVERYTHING,
    }));
    expect(decision.reason).toBe('pinned_provider_unavailable');
    expect(decision.detail).toContain('not among the candidate providers');
  });
});

// ─── Session-bound work ──────────────────────────────────────────────

describe('selectProvider — work bound to its origin session', () => {
  it('follows the origin session CLI even when a cheaper provider is available', () => {
    const decision = expectSelected(selectProvider(summaryPacket, {
      candidates: ALL_PROFILES,
      isAvailable: EVERYTHING,
      originSessionProvider: 'claude',
    }));
    // Kimi outranks Claude in the preference order, but a summary reads *this*
    // conversation's context and cannot move.
    expect(decision.provider).toBe('claude');
    expect(decision.reason).toBe('origin_session');
    expect(decision.alternatives).toEqual([]);
    expect(rejectionFor(decision, 'kimi')?.reason).toBe('origin_session_mismatch');
    expect(rejectionFor(decision, 'copilot')?.reason).toBe('origin_session_mismatch');
  });

  it('refuses to guess when the caller cannot say which CLI the session runs', () => {
    const decision = expectFailed(selectProvider(summaryPacket, {
      candidates: ALL_PROFILES,
      isAvailable: EVERYTHING,
    }));
    expect(decision.reason).toBe('origin_session_unknown');
    expect(decision.failure).toBe('session_unavailable');
    expect(decision.detail).toContain('originSessionProvider');
    expect(decision.rejected).toEqual([]);
  });

  it('fails with a session-scoped code when the session CLI is not installed', () => {
    const decision = expectFailed(selectProvider(summaryPacket, {
      candidates: ALL_PROFILES,
      isAvailable: THIS_MACHINE,
      originSessionProvider: 'kimi',
    }));
    expect(decision.reason).toBe('origin_session_unavailable');
    expect(decision.failure).toBe('session_unavailable');
  });

  it('fails when the session CLI lacks a capability the packet requires', () => {
    const acpSummary: WorkPacket = { ...summaryPacket, constraints: { requires: ['supportsAcp'] } };
    const decision = expectFailed(selectProvider(acpSummary, {
      candidates: ALL_PROFILES,
      isAvailable: EVERYTHING,
      originSessionProvider: 'claude',
    }));
    expect(decision.reason).toBe('origin_session_ineligible');
    expect(decision.failure).toBe('session_unavailable');
    expect(decision.detail).toContain('supportsAcp');
  });

  it('ignores originSessionProvider for work that is not session-bound', () => {
    const decision = expectSelected(selectProvider(queryPacket, {
      candidates: ALL_PROFILES,
      isAvailable: EVERYTHING,
      originSessionProvider: 'copilot',
    }));
    expect(decision.provider).toBe('kimi');
    expect(decision.reason).toBe('preferred');
  });

  it('honours an explicit requiresOriginSession override on free-floating work', () => {
    const bound: WorkPacket = {
      ...queryPacket,
      origin: { sessionId: SESSION_ID },
      requiresOriginSession: true,
    };
    const decision = expectSelected(selectProvider(bound, {
      candidates: ALL_PROFILES,
      isAvailable: EVERYTHING,
      originSessionProvider: 'copilot',
    }));
    expect(decision.provider).toBe('copilot');
    expect(decision.reason).toBe('origin_session');
  });

  it('releases a summary from its session when the packet opts out', () => {
    const unbound: WorkPacket = { ...summaryPacket, requiresOriginSession: false };
    const decision = expectSelected(selectProvider(unbound, {
      candidates: ALL_PROFILES,
      isAvailable: EVERYTHING,
    }));
    expect(decision.provider).toBe('kimi');
    expect(decision.reason).toBe('preferred');
  });
});

describe('selectProvider — pin plus session binding', () => {
  it('selects the pinned provider when the origin session agrees', () => {
    const decision = expectSelected(selectProvider(handoffPacket, {
      candidates: ALL_PROFILES,
      isAvailable: THIS_MACHINE,
      originSessionProvider: 'claude',
    }));
    expect(decision.provider).toBe('claude');
    // The explicit pin is the more specific fact, so it is what gets logged.
    expect(decision.reason).toBe('pinned');
  });

  it('refuses to drop one constraint when the pin and the session disagree', () => {
    const decision = expectFailed(selectProvider(handoffPacket, {
      candidates: ALL_PROFILES,
      isAvailable: EVERYTHING,
      originSessionProvider: 'copilot',
    }));
    expect(decision.reason).toBe('pin_conflicts_with_origin_session');
    expect(decision.failure).toBe('no_provider');
    expect(decision.detail).toContain('claude');
    expect(decision.detail).toContain('copilot');
  });
});

// ─── Nothing to choose from ──────────────────────────────────────────

describe('selectProvider — nothing selectable', () => {
  it('reports an empty candidate list distinctly', () => {
    const decision = expectFailed(selectProvider(queryPacket, {
      candidates: [],
      isAvailable: EVERYTHING,
    }));
    expect(decision.reason).toBe('no_candidates');
    expect(decision.failure).toBe('no_provider');
    expect(decision.rejected).toEqual([]);
  });

  it('reports none_available when every candidate is uninstalled', () => {
    const decision = expectFailed(selectProvider(queryPacket, {
      candidates: ALL_PROFILES,
      isAvailable: NOTHING,
    }));
    expect(decision.reason).toBe('none_available');
    expect(decision.failure).toBe('no_provider');
    expect(decision.rejected.map(entry => entry.reason))
      .toEqual(['unavailable', 'unavailable', 'unavailable']);
  });

  it('rejects an invalid packet before considering any provider', () => {
    // A summary with no origin session: session-bound work with nothing to read.
    const broken = { id: 'wp-broken', kind: 'summary', instruction: 'x' } as unknown as WorkPacket;
    const decision = expectFailed(selectProvider(broken, {
      candidates: ALL_PROFILES,
      isAvailable: EVERYTHING,
    }));
    expect(decision.reason).toBe('invalid_packet');
    expect(decision.failure).toBe('invalid_packet');
    expect(decision.rejected).toEqual([]);
    expect(decision.issues?.map(entry => entry.path)).toContain('origin.sessionId');
  });

  it('maps every dispatch failure reason to a WorkResult failure code', () => {
    const reasons = Object.keys(DISPATCH_FAILURE_TO_WORK_FAILURE) as DispatchFailureReason[];
    expect(reasons.length).toBeGreaterThan(0);
    for (const reason of reasons) {
      expect(DISPATCH_FAILURE_TO_WORK_FAILURE[reason]).toBeTruthy();
    }
  });
});

// ─── Determinism ─────────────────────────────────────────────────────

describe('selectProvider — deterministic tie-breaking', () => {
  it('gives the same answer whatever order the candidates arrive in', () => {
    const orders: ProviderProfile[][] = [
      [CLAUDE, COPILOT, KIMI],
      [KIMI, COPILOT, CLAUDE],
      [COPILOT, CLAUDE, KIMI],
      [COPILOT, KIMI, CLAUDE],
    ];
    const picks = orders.map(candidates =>
      expectSelected(selectProvider(queryPacket, { candidates, isAvailable: THIS_MACHINE })));
    expect(picks.map(decision => decision.provider)).toEqual(['claude', 'claude', 'claude', 'claude']);
    expect(picks.map(decision => decision.alternatives.join(','))).toEqual(
      ['copilot', 'copilot', 'copilot', 'copilot'],
    );
  });

  it('breaks ties between unranked providers on provider id, ascending', () => {
    // Neither copilot nor kimi appears in this preference order, so only the
    // tie-break separates them.
    const decision = expectSelected(selectProvider(queryPacket, {
      candidates: [KIMI, COPILOT],
      isAvailable: EVERYTHING,
      preference: ['claude'],
    }));
    expect(decision.provider).toBe('copilot');
    expect(decision.reason).toBe('unranked');
    expect(decision.alternatives).toEqual(['kimi']);
    expect(decision.detail).toContain('ORCHESTRATOR_PROVIDER_PREFERENCE');
  });

  it('ranks listed providers ahead of unranked ones', () => {
    const decision = expectSelected(selectProvider(queryPacket, {
      candidates: [COPILOT, KIMI, CLAUDE],
      isAvailable: EVERYTHING,
      preference: ['claude'],
    }));
    expect(decision.provider).toBe('claude');
    expect(decision.alternatives).toEqual(['copilot', 'kimi']);
  });

  it('collapses duplicate candidate profiles and leaves the caller array untouched', () => {
    const candidates = [COPILOT, CLAUDE, COPILOT];
    const decision = expectSelected(selectProvider(queryPacket, {
      candidates,
      isAvailable: availability('copilot'),
    }));
    expect(decision.provider).toBe('copilot');
    expect(decision.rejected.map(entry => entry.provider)).toEqual(['claude']);
    expect(candidates).toEqual([COPILOT, CLAUDE, COPILOT]);
  });

  it('is a pure function of its inputs', () => {
    const options = { candidates: ALL_PROFILES, isAvailable: THIS_MACHINE };
    expect(selectProvider(searchPacket, options)).toEqual(selectProvider(searchPacket, options));
  });
});

// ─── Every kind gets a decision ──────────────────────────────────────

describe('selectProvider — the four kinds the app issues today', () => {
  it('routes each of them on this machine', () => {
    const decisions = {
      summary: selectProvider(summaryPacket, {
        candidates: ALL_PROFILES, isAvailable: THIS_MACHINE, originSessionProvider: 'claude',
      }),
      handoff: selectProvider(handoffPacket, {
        candidates: ALL_PROFILES, isAvailable: THIS_MACHINE, originSessionProvider: 'claude',
      }),
      query: selectProvider(queryPacket, { candidates: ALL_PROFILES, isAvailable: THIS_MACHINE }),
      search: selectProvider(searchPacket, { candidates: ALL_PROFILES, isAvailable: THIS_MACHINE }),
    };
    expect(expectSelected(decisions.summary).provider).toBe('claude');
    expect(expectSelected(decisions.handoff).provider).toBe('claude');
    expect(expectSelected(decisions.query).provider).toBe('claude');
    expect(expectSelected(decisions.search).provider).toBe('copilot');
  });
});

// ─── Logging ─────────────────────────────────────────────────────────

describe('describeDispatchDecision', () => {
  it('names the winner, the reason, the fallbacks, and every rejection', () => {
    const line = describeDispatchDecision(selectProvider(searchPacket, {
      candidates: ALL_PROFILES,
      isAvailable: THIS_MACHINE,
    }));
    expect(line).toContain("selected 'copilot'");
    expect(line).toContain('[preferred]');
    expect(line).toContain('claude (missing supportsAcp)');
    expect(line).toContain('kimi (unavailable)');
  });

  it('explains a non-selection, including the coarse failure code', () => {
    const line = describeDispatchDecision(selectProvider(queryPacket, {
      candidates: ALL_PROFILES,
      isAvailable: NOTHING,
    }));
    expect(line).toContain('no provider');
    expect(line).toContain('none_available → no_provider');
  });

  it('never leaks the packet instruction into a log line', () => {
    const secret = 'SUPER-SECRET-USER-CONTENT';
    const packet: WorkPacket = { ...queryPacket, instruction: secret };
    const line = describeDispatchDecision(selectProvider(packet, {
      candidates: ALL_PROFILES,
      isAvailable: NOTHING,
    }));
    expect(line).not.toContain(secret);
  });
});
