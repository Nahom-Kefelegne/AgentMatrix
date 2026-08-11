/**
 * Provider selection for a `WorkPacket`: given a packet, the providers a caller
 * is willing to consider, and whether each is actually installed — which one
 * should run it, and *why*?
 *
 * WHY THIS EXISTS
 * ---------------
 * `WorkPacket` named the facts about a unit of out-of-band work, and
 * `checkProviderEligibility` answers "does candidate X qualify?" for exactly one
 * candidate. Neither chooses. Every out-of-band call site
 * (`SummaryService`, `HandoffService`, `OrchestratorService`) still decides its
 * provider implicitly — by whichever session it happens to hold — and when that
 * decision goes wrong the user sees `{ success: false, content: '', lines: [] }`
 * with no explanation. That silence is the failure mode this module is built to
 * end: the decision is returned as data, with a reason for the winner *and* a
 * reason for every candidate that lost.
 *
 * SCOPE — SELECTION ONLY.
 * This module picks a provider. It does not run anything, does not queue, does
 * not retry, and is wired into nothing. `captureQuery`, `SummaryService`,
 * `HandoffService` and the socket layer are untouched by design; wiring is a
 * separate change so that "who should run this?" can be reviewed and tested
 * before any behaviour moves.
 *
 * THIS MODULE IS PURE FUNCTIONS ONLY.
 * Same constraint `WorkPacket.ts` documents, for the same reason: `lib/dispatch/`
 * is imported from the React client as well as the Electron main process, so it
 * must not import `fs`, `child_process`, `electron`, or React. Consequently the
 * two facts a real selection needs but this module cannot observe — which
 * providers are installed, and which CLI a session was spawned under — are
 * INJECTED as parameters, exactly as `resolveOrchestratorProvider` injects
 * `isAvailable`. That is what makes the policy testable without node-pty.
 *
 * ON TRUSTING CAPABILITY FLAGS
 * Selection trusts `ProviderProfile` and nothing else. It never assumes a
 * provider can do something its flags do not claim, and it never special-cases a
 * provider by name. Today that matters concretely: only Copilot has a verified
 * ACP mode; `KimiProvider` sets `supportsAcp = true` from Kimi's documentation
 * but has never been run against a live binary. The lever for "declared but not
 * proven here" is `isAvailable` — an unverified or uninstalled provider reports
 * false and is rejected with an explicit `unavailable` reason. It is NOT this
 * module's job to hardcode that judgement, and a maintainer changing what
 * `isAvailable` reports changes routing accordingly.
 */

import type { CliType } from '../cli/CliProvider';
import { ORCHESTRATOR_PROVIDER_PREFERENCE } from '../state/orchestratorProvider';
import {
  checkProviderEligibility,
  mustRunInOriginSession,
  validateWorkPacket,
  type CapabilityFlag,
  type ProviderProfile,
  type WorkFailureReason,
  type WorkPacket,
  type WorkPacketIssue,
} from './WorkPacket';

// ─── Inputs ──────────────────────────────────────────────────────────

export interface DispatchOptions {
  /**
   * Every provider the caller is willing to consider, as the serializable
   * profile `capabilityProfile()` produces. Providers absent from this list are
   * not considered at all — omission is how a caller says "never route here",
   * and it is reported distinctly from "installed but unsuitable".
   *
   * Duplicates by `type` are collapsed, first occurrence winning, so a caller
   * that concatenates two provider lists cannot accidentally weight one twice.
   */
  candidates: readonly ProviderProfile[];

  /**
   * Is this provider actually runnable on this machine right now? Injected
   * because answering it means touching the filesystem (`findBinary`), which
   * this module may not do. Mirrors `resolveOrchestratorProvider`'s probe, and
   * carries the same contract: it must not throw for a provider that has no
   * registration yet — it should simply report false.
   */
  isAvailable: (provider: CliType) => boolean;

  /**
   * Ranking order, cheapest-capable-first. Defaults to
   * `ORCHESTRATOR_PROVIDER_PREFERENCE`, which is deliberately the *only* place
   * that order is written down ("THIS IS THE ONE KNOB"). This parameter exists
   * for tests and for a caller with a genuinely different cost model — not as a
   * second place to encode the house preference.
   */
  preference?: readonly CliType[];

  /**
   * Which CLI the packet's origin session is already running as — i.e.
   * `PtySession.cliType`. Required whenever `mustRunInOriginSession(packet)` is
   * true (summary and handoff, today), because such work reads that specific
   * conversation's context and therefore cannot move: `captureQuery` derives its
   * whole strategy from `ptySession.cliType`. Ignored otherwise.
   *
   * A caller that cannot supply it gets a refusal rather than a guess — see
   * `origin_session_unknown`.
   */
  originSessionProvider?: CliType;
}

// ─── Outputs ─────────────────────────────────────────────────────────

/** Why one candidate was ruled out. Exactly one primary category per candidate;
 *  the full picture is still on the entry (`available`, `missingCapabilities`). */
export type DispatchRejectionReason =
  /** The packet pins a different provider (`constraints.provider`). */
  | 'pinned_provider_mismatch'
  /** The packet must run in its origin session, which is a different CLI. */
  | 'origin_session_mismatch'
  /** Lacks capability flags the packet declares in `constraints.requires`. */
  | 'missing_capabilities'
  /** Suitable, but `isAvailable` says it cannot run here. */
  | 'unavailable';

export interface DispatchRejection {
  provider: CliType;
  /**
   * The primary reason, assigned in a fixed order: pin mismatch → origin-session
   * mismatch → missing capabilities → unavailable. Fit-with-this-packet is
   * reported ahead of availability because it is the permanent fact (installing
   * Copilot will never give it `supportsMcp`), while unavailability is
   * environmental. No information is lost either way: the two fields below are
   * populated on every entry regardless of which category won.
   */
  reason: DispatchRejectionReason;
  /** What `isAvailable` reported for this provider. */
  available: boolean;
  /** Declared capabilities this provider lacks; `[]` when it has them all. */
  missingCapabilities: CapabilityFlag[];
  /**
   * Human-readable and safe to log. Deliberately mentions only the packet id and
   * kind — never `instruction`, which is user content and may be large.
   */
  detail: string;
}

/** Why the winner won. */
export type DispatchSelectionReason =
  /** The packet pinned it explicitly and it qualified. */
  | 'pinned'
  /** Forced by the origin session's CLI (session-bound work). */
  | 'origin_session'
  /** Highest-ranked eligible provider in the preference order. */
  | 'preferred'
  /**
   * Eligible, but absent from the preference order, so it was chosen by the
   * tie-break alone. Worth logging loudly: it means a `CliType` exists that
   * `ORCHESTRATOR_PROVIDER_PREFERENCE` has never been told about.
   */
  | 'unranked';

export interface DispatchSelection {
  selected: true;
  provider: CliType;
  reason: DispatchSelectionReason;
  detail: string;
  /**
   * The other eligible providers, in the same ranked order, best first. These
   * are *not* rejections — they are the fail-over list a caller can walk if the
   * winner errors at run time. Usually empty.
   */
  alternatives: CliType[];
  /** Every candidate that was ruled out, and why. */
  rejected: DispatchRejection[];
}

/** Why nothing was selected. Finer-grained than `WorkFailureReason` because a
 *  log line that only says "no_provider" is the ambiguity this module exists to
 *  remove; `failure` below carries the coarse code for building a `WorkResult`. */
export type DispatchFailureReason =
  /** The packet itself does not validate; nothing was even considered. */
  | 'invalid_packet'
  /** The caller offered no candidates at all. */
  | 'no_candidates'
  /** Candidates existed, but every one of them is uninstalled. */
  | 'none_available'
  /** Candidates were available, but none satisfies the packet's constraints. */
  | 'none_eligible'
  /** `constraints.provider` names a provider that cannot run here. */
  | 'pinned_provider_unavailable'
  /** `constraints.provider` is available but lacks a required capability. */
  | 'pinned_provider_ineligible'
  /** Session-bound work whose origin session's CLI the caller did not supply. */
  | 'origin_session_unknown'
  /** The origin session's CLI cannot run here. */
  | 'origin_session_unavailable'
  /** The origin session's CLI lacks a required capability. */
  | 'origin_session_ineligible'
  /** The packet pins one provider while its origin session is another. No
   *  provider can satisfy both, so neither constraint is quietly dropped. */
  | 'pin_conflicts_with_origin_session';

export interface DispatchFailure {
  selected: false;
  reason: DispatchFailureReason;
  /**
   * The coarse code from `WorkPacket.ts`, so a caller can construct a
   * `WorkResult` without re-deriving the mapping. See
   * `DISPATCH_FAILURE_TO_WORK_FAILURE`.
   */
  failure: WorkFailureReason;
  detail: string;
  /** Every candidate that was ruled out, and why. Empty when the packet was
   *  invalid or no candidates were offered — nothing got that far. */
  rejected: DispatchRejection[];
  /** Present only for `invalid_packet`: the validator's issues, verbatim. */
  issues?: WorkPacketIssue[];
}

export type DispatchDecision = DispatchSelection | DispatchFailure;

/**
 * Fine-grained dispatch reason → the coarse `WorkFailureReason` a `WorkResult`
 * carries. Origin-session problems map to `session_unavailable` rather than
 * `no_provider` because the provider set is not the thing at fault: the work is
 * pinned to a conversation the caller could not describe or reach.
 */
export const DISPATCH_FAILURE_TO_WORK_FAILURE: Readonly<Record<DispatchFailureReason, WorkFailureReason>> = {
  invalid_packet: 'invalid_packet',
  no_candidates: 'no_provider',
  none_available: 'no_provider',
  none_eligible: 'no_provider',
  pinned_provider_unavailable: 'no_provider',
  pinned_provider_ineligible: 'no_provider',
  origin_session_unknown: 'session_unavailable',
  origin_session_unavailable: 'session_unavailable',
  origin_session_ineligible: 'session_unavailable',
  pin_conflicts_with_origin_session: 'no_provider',
};

// ─── Internals ───────────────────────────────────────────────────────

/** First occurrence of each `type` wins; see `DispatchOptions.candidates`. */
function dedupeCandidates(candidates: readonly ProviderProfile[]): ProviderProfile[] {
  const seen = new Set<CliType>();
  const unique: ProviderProfile[] = [];
  for (const profile of candidates) {
    if (seen.has(profile.type)) continue;
    seen.add(profile.type);
    unique.push(profile);
  }
  return unique;
}

/** Position in the preference order; unlisted providers sort after every listed
 *  one rather than being excluded — an unranked provider is still better than no
 *  provider, and the `unranked` selection reason makes the gap visible. */
function preferenceRank(provider: CliType, preference: readonly CliType[]): number {
  const index = preference.indexOf(provider);
  return index === -1 ? preference.length : index;
}

/**
 * TIE-BREAKING IS DETERMINISTIC, AND DELIBERATELY INDEPENDENT OF INPUT ORDER.
 *
 * Ranked by preference index first. Ties — which in practice means two providers
 * that are both absent from the preference order — break on provider id
 * ascending (plain lexicographic, not locale-aware, so it cannot vary by
 * machine). Candidate array order is never consulted: the same *set* of
 * providers must yield the same choice however the caller happened to enumerate
 * them, otherwise a routing bug would reproduce only on one machine's provider
 * registration order.
 */
function compareByPreference(
  a: ProviderProfile,
  b: ProviderProfile,
  preference: readonly CliType[],
): number {
  const byRank = preferenceRank(a.type, preference) - preferenceRank(b.type, preference);
  if (byRank !== 0) return byRank;
  if (a.type === b.type) return 0;
  return a.type < b.type ? -1 : 1;
}

function fail(
  reason: DispatchFailureReason,
  detail: string,
  rejected: DispatchRejection[],
  issues?: WorkPacketIssue[],
): DispatchFailure {
  const failure: DispatchFailure = {
    selected: false,
    reason,
    failure: DISPATCH_FAILURE_TO_WORK_FAILURE[reason],
    detail,
    rejected,
  };
  if (issues !== undefined) failure.issues = issues;
  return failure;
}

/** Short packet label for log lines. Never includes `instruction`. */
function describePacket(packet: WorkPacket): string {
  return `packet ${packet.id} (${packet.kind})`;
}

// ─── The policy ──────────────────────────────────────────────────────

/**
 * Choose the provider that should run `packet`.
 *
 * THE POLICY, IN ORDER
 *
 *  1. The packet must validate. An unvalidatable packet is a caller bug, not a
 *     routing outcome, and is reported with the validator's own issues rather
 *     than as "no provider".
 *  2. Hard constraints filter; they never rank. A pinned `constraints.provider`
 *     and a session-bound packet's origin CLI are both absolute — a provider
 *     either is that one or it is out. Where both apply and disagree, the packet
 *     is unsatisfiable and says so, instead of silently honouring one.
 *  3. `constraints.requires` filters via `checkProviderEligibility`, which is
 *     reused rather than reimplemented so a packet can never be judged by two
 *     different definitions of "qualifies".
 *  4. `isAvailable` filters. Kept last of the filters, and reported as its own
 *     reason, so "not installed" is never confused with "not capable".
 *  5. Whatever survives is ranked by `ORCHESTRATOR_PROVIDER_PREFERENCE`
 *     (cheapest-capable-first), with the deterministic tie-break above. The
 *     first is chosen; the rest come back as `alternatives`.
 *
 * NO IMPLICIT CAPABILITY REQUIREMENTS ARE ADDED. It is tempting to demand
 * `supportsAcp` for out-of-band work, but `captureQuery` deliberately falls back
 * to the PTY injector for providers without it, so inventing that requirement
 * here would reject providers that demonstrably do the job today. Only what the
 * packet declares is enforced.
 *
 * Returns a decision, never throws.
 */
export function selectProvider(packet: WorkPacket, options: DispatchOptions): DispatchDecision {
  // Validate defensively even though the parameter is typed: packets cross a
  // socket, and `validateWorkPacket` is the seam that turns wire data into a
  // packet. Selection then runs against the *normalized* packet so a trimmed
  // pin or de-duplicated `requires` is what actually gets matched.
  const validation = validateWorkPacket(packet);
  if (!validation.ok) {
    const paths = validation.issues.map(entry => entry.path || '<packet>').join(', ');
    return fail(
      'invalid_packet',
      `The packet does not validate, so no provider was considered. Offending fields: ${paths}.`,
      [],
      validation.issues,
    );
  }
  const work = validation.packet;

  const preference = options.preference ?? ORCHESTRATOR_PROVIDER_PREFERENCE;
  const candidates = dedupeCandidates(options.candidates);
  if (candidates.length === 0) {
    return fail('no_candidates', `${describePacket(work)}: no candidate providers were offered.`, []);
  }

  const pinned = work.constraints?.provider;
  const boundToOrigin = mustRunInOriginSession(work);
  const sessionProvider = boundToOrigin ? options.originSessionProvider : undefined;

  if (boundToOrigin && sessionProvider === undefined) {
    return fail(
      'origin_session_unknown',
      `${describePacket(work)} must run inside its origin session `
        + `(${work.origin?.sessionId ?? 'unknown session'}), but the caller did not say which CLI that `
        + `session runs as. Pass options.originSessionProvider (PtySession.cliType).`,
      [],
    );
  }
  if (pinned !== undefined && sessionProvider !== undefined && pinned !== sessionProvider) {
    return fail(
      'pin_conflicts_with_origin_session',
      `${describePacket(work)} pins provider '${pinned}' but must run inside its origin session, which is a `
        + `'${sessionProvider}' session. No provider satisfies both constraints.`,
      [],
    );
  }

  /** The single provider this packet is locked to, if any. */
  const required = pinned ?? sessionProvider;

  const rejected: DispatchRejection[] = [];
  const eligible: ProviderProfile[] = [];

  for (const profile of candidates) {
    // Reused wholesale: pin matching and capability matching have exactly one
    // definition in this codebase, and it lives in WorkPacket.ts.
    const eligibility = checkProviderEligibility(work, profile);
    const available = options.isAvailable(profile.type);
    const originMismatch = sessionProvider !== undefined && profile.type !== sessionProvider;

    const base = {
      provider: profile.type,
      available,
      missingCapabilities: eligibility.missingCapabilities,
    };

    if (eligibility.pinnedProviderMismatch) {
      rejected.push({
        ...base,
        reason: 'pinned_provider_mismatch',
        detail: `${describePacket(work)} pins provider '${pinned}', not '${profile.type}'.`,
      });
    } else if (originMismatch) {
      rejected.push({
        ...base,
        reason: 'origin_session_mismatch',
        detail: `${describePacket(work)} must run inside its origin session, which is a '${sessionProvider}' `
          + `session, not '${profile.type}'.`,
      });
    } else if (eligibility.missingCapabilities.length > 0) {
      rejected.push({
        ...base,
        reason: 'missing_capabilities',
        detail: `'${profile.type}' lacks capabilities required by ${describePacket(work)}: `
          + `${eligibility.missingCapabilities.join(', ')}.`,
      });
    } else if (!available) {
      rejected.push({
        ...base,
        reason: 'unavailable',
        detail: `'${profile.type}' satisfies ${describePacket(work)} but is not available on this machine.`,
      });
    } else {
      eligible.push(profile);
    }
  }

  if (eligible.length === 0) {
    return classifyEmptySelection(work, required, pinned !== undefined, rejected);
  }

  const ranked = [...eligible].sort((a, b) => compareByPreference(a, b, preference));
  const winner = ranked[0];
  const rank = preferenceRank(winner.type, preference);

  let reason: DispatchSelectionReason;
  let detail: string;
  if (pinned !== undefined) {
    // An explicit pin outranks the origin-session rule as an *explanation* even
    // when both point at the same provider: the packet author asked for it by
    // name, and that is the more specific fact to log.
    reason = 'pinned';
    detail = `${describePacket(work)} pins provider '${winner.type}', which is available and satisfies every `
      + `required capability.`;
  } else if (sessionProvider !== undefined) {
    reason = 'origin_session';
    detail = `${describePacket(work)} must run inside its origin session, which is a '${winner.type}' session; `
      + `that provider is available and satisfies every required capability.`;
  } else if (rank < preference.length) {
    reason = 'preferred';
    detail = `'${winner.type}' is the highest-preference eligible provider (order: ${preference.join(' > ')}).`;
  } else {
    reason = 'unranked';
    detail = `'${winner.type}' is eligible but absent from the preference order (${preference.join(' > ')}), so it `
      + `was chosen by provider-id tie-break. Consider adding it to ORCHESTRATOR_PROVIDER_PREFERENCE.`;
  }

  return {
    selected: true,
    provider: winner.type,
    reason,
    detail,
    alternatives: ranked.slice(1).map(profile => profile.type),
    rejected,
  };
}

/**
 * Nothing survived the filters — say precisely why, distinguishing the case
 * where one specific provider was demanded (pin or origin session) from the case
 * where the whole field came up short.
 */
function classifyEmptySelection(
  work: WorkPacket,
  required: CliType | undefined,
  pinned: boolean,
  rejected: DispatchRejection[],
): DispatchFailure {
  if (required !== undefined) {
    const entry = rejected.find(item => item.provider === required);
    const source = pinned
      ? `${describePacket(work)} pins provider '${required}'`
      : `${describePacket(work)} must run inside its origin session, a '${required}' session`;

    if (entry === undefined) {
      // The demanded provider was never offered as a candidate at all — a
      // different failure from "offered and unusable", and usually a caller bug.
      return fail(
        pinned ? 'pinned_provider_unavailable' : 'origin_session_unavailable',
        `${source}, which was not among the candidate providers `
          + `(${rejected.map(item => item.provider).join(', ') || 'none'}).`,
        rejected,
      );
    }
    if (entry.reason === 'unavailable') {
      return fail(
        pinned ? 'pinned_provider_unavailable' : 'origin_session_unavailable',
        `${source}, which is not available on this machine.`,
        rejected,
      );
    }
    return fail(
      pinned ? 'pinned_provider_ineligible' : 'origin_session_ineligible',
      `${source}, which lacks required capabilities: ${entry.missingCapabilities.join(', ') || 'unknown'}.`,
      rejected,
    );
  }

  // No provider was demanded, so report which wall the whole field hit. "Every
  // candidate is uninstalled" is an install problem; anything else is a
  // capability problem, and the two want different fixes.
  const everyoneUnavailable = rejected.every(item => item.reason === 'unavailable');
  return everyoneUnavailable
    ? fail(
      'none_available',
      `${describePacket(work)}: every candidate provider `
        + `(${rejected.map(item => item.provider).join(', ')}) is unavailable on this machine.`,
      rejected,
    )
    : fail(
      'none_eligible',
      `${describePacket(work)}: no candidate provider satisfies its constraints. `
        + `${rejected.map(item => `${item.provider}: ${item.reason}`).join('; ')}.`,
      rejected,
    );
}

// ─── Logging ─────────────────────────────────────────────────────────

/**
 * One-line rendering of a decision, for the log call a caller should make at the
 * routing seam. Kept here rather than left to each call site so that "why did
 * nothing run?" reads the same everywhere — the whole point of returning a rich
 * decision is lost if callers only log `provider ?? 'none'`.
 *
 * Contains no packet instruction text, so it is safe to write to the console.
 */
export function describeDispatchDecision(decision: DispatchDecision): string {
  const rejected = decision.rejected.length === 0
    ? ''
    : ` | rejected: ${decision.rejected
      .map(item => item.reason === 'missing_capabilities'
        ? `${item.provider} (missing ${item.missingCapabilities.join('+')})`
        : `${item.provider} (${item.reason})`)
      .join(', ')}`;

  if (decision.selected) {
    const alternatives = decision.alternatives.length === 0
      ? ''
      : ` | fallbacks: ${decision.alternatives.join(', ')}`;
    return `dispatch: selected '${decision.provider}' [${decision.reason}] — ${decision.detail}`
      + `${alternatives}${rejected}`;
  }
  return `dispatch: no provider [${decision.reason} → ${decision.failure}] — ${decision.detail}${rejected}`;
}

/*
 * DELIBERATELY NOT BUILT HERE — things a dispatcher needs that are not selection:
 *
 *  - Execution. Nothing here spawns, injects, or calls `captureQuery`; the
 *    decision is data a runner consumes later.
 *  - Queueing and concurrency. `priority` exists on the packet and is untouched
 *    by this module: ordering *between* packets is a queue's job, and there is
 *    no queue yet. Ranking here is strictly within one packet's candidate set.
 *  - Effort-sensitive re-ranking. `effort: 'high'` could plausibly flip the
 *    order towards the most capable provider, but the repo records no evidence
 *    of which provider that is, and `ORCHESTRATOR_PROVIDER_PREFERENCE` is
 *    documented as the single ordering knob. A second, hidden knob here would
 *    make routing unexplainable. If that policy is wanted, it belongs in the
 *    preference list, not in this function.
 *  - Load balancing / stickiness / round-robin. All require mutable state across
 *    calls; this function is pure and returns the same answer for the same
 *    inputs, which is what makes it testable and loggable.
 *  - Fallback execution. `alternatives` is offered so a caller *can* fail over,
 *    but retry policy stays with the runner — `captureQuery` already owns a
 *    fallback ladder, and a second one here would compound with it invisibly.
 */
