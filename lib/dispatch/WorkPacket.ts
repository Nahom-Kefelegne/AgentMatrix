/**
 * A `WorkPacket` is one self-contained unit of out-of-band work that could be
 * handed to *some* CLI provider.
 *
 * WHY THIS EXISTS
 * ---------------
 * The app already runs work out-of-band against agent sessions in three places,
 * and all three do it by hand-rolling a prompt string and calling
 * `captureQuery(ptyManager, ptySession, instruction, opts, activity)`:
 *
 *   - `electron/services/SummaryService.ts`  — "summarize this session" (3 bullets)
 *   - `electron/services/HandoffService.ts`  — "write a context handoff document"
 *   - `electron/services/OrchestratorService.ts` — free-form orchestrator queries,
 *     including the Deep Session Search issued by `app/components/ResumeModal.tsx`
 *
 * Each caller re-derives, informally and inconsistently, the same four facts:
 * what to ask, where it has to run, how long to wait, and what to call it in the
 * UI. A dispatcher can't route work it can only see as a `string`. `WorkPacket`
 * names those facts once so a future dispatcher has something to reason about,
 * and so the existing three call sites can be expressed in a single shape.
 *
 * THIS MODULE IS DATA + PURE FUNCTIONS ONLY.
 * It is imported from both the Electron main process and the React client, so —
 * exactly as `lib/cli/uiMetadata.ts` documents for the same reason — it must not
 * import `fs`, `child_process`, `electron`, or React. The only import here is a
 * type-only one, which erases at compile time.
 *
 * A packet must also survive `JSON.stringify` → socket/IPC → `JSON.parse`
 * unchanged, because that is the boundary the existing `orchestrator:query`
 * event already crosses. Hence: no functions, no `Date` objects, no `Map`/`Set`
 * in the wire shape — timestamps are epoch milliseconds, matching the
 * `createdAt` / `lastActivity` / `ts` convention in `lib/types.ts`.
 *
 * A packet is an immutable *request*. It deliberately carries no mutable
 * lifecycle status; see `WorkResult` below and the "Deliberately absent" notes.
 */

import type { CliProvider, CliType } from '../cli/CliProvider';

// ─── Work kinds ──────────────────────────────────────────────────────

/**
 * What sort of work this is. The discriminator exists so a dispatcher can apply
 * per-kind policy (timeouts, session-binding, cost) without parsing the
 * instruction text.
 *
 * Every member below is a kind the app performs *today* — this union is
 * deliberately not aspirational:
 *
 *  - `summary`  — condense what a session has done. `SummaryService.requestSummary`.
 *  - `handoff`  — export a session's context as a document another session can
 *                 absorb. `HandoffService.generateHandoffSummary`.
 *  - `query`    — a free-form instruction whose text output is captured.
 *                 `OrchestratorService.queryOrchestrator`.
 *  - `search`   — grep the on-disk transcripts for sessions matching a
 *                 description (Deep Session Search in `ResumeModal`). It rides
 *                 on `queryOrchestrator` today, but it is its own kind because
 *                 it is the one case that needs shell + filesystem reach, wants
 *                 a much longer timeout, and must NOT be pinned to a user's
 *                 session (it would pollute that conversation's context).
 */
export const WORK_KINDS = ['summary', 'handoff', 'query', 'search'] as const;

export type WorkKind = (typeof WORK_KINDS)[number];

/**
 * Kinds that are meaningless without the conversation they refer to. Summary
 * and handoff both read the *originating session's* context, which is why both
 * services bail out early when that session is missing or closed. Query and
 * search carry all their input in the instruction, so they are free to run
 * anywhere (the orchestrator session, today).
 */
export const SESSION_BOUND_KINDS: readonly WorkKind[] = ['summary', 'handoff'];

// ─── Provider constraints ────────────────────────────────────────────

/**
 * The boolean capability flags declared by `CliProvider`, derived from the
 * interface itself rather than re-typed. Adding `supportsFoo: boolean` to
 * `CliProvider` widens this union automatically, and the drift guard below then
 * forces `CAPABILITY_FLAGS` to be updated — so the two can never silently
 * disagree.
 */
export type CapabilityFlag = {
  [K in keyof CliProvider]-?: K extends `supports${string}`
    ? CliProvider[K] extends boolean
      ? K
      : never
    : never;
}[keyof CliProvider];

/** Runtime mirror of `CapabilityFlag`, needed because types erase and the
 *  validator has to check values arriving off the wire. */
export const CAPABILITY_FLAGS = [
  'supportsMcp',
  'supportsFork',
  'supportsContextTracking',
  'supportsSubagents',
  'supportsAcp',
] as const satisfies readonly CapabilityFlag[];

/** Compile-time drift guard: if `CliProvider` gains or renames a `supports*`
 *  flag, this line stops compiling until `CAPABILITY_FLAGS` is updated. */
type UnlistedCapabilityFlag = Exclude<CapabilityFlag, (typeof CAPABILITY_FLAGS)[number]>;
const _capabilityFlagsAreExhaustive: [UnlistedCapabilityFlag] extends [never] ? true : UnlistedCapabilityFlag = true;
void _capabilityFlagsAreExhaustive;

/**
 * Providers a packet may be pinned to: `CliType`, i.e. the ones `getProvider`
 * can actually instantiate — deliberately not the wider
 * `OrchestratorProviderSetting`, which also carries `'auto'`. A packet states
 * hard requirements only; *choosing* among providers is
 * `lib/state/orchestratorProvider.ts`'s job, and `'auto'` is a choice.
 */
export const DISPATCHABLE_PROVIDERS = ['claude', 'copilot', 'kimi', 'codex'] as const satisfies readonly CliType[];

/** Same drift guard, for `CliType`. */
type UnlistedProvider = Exclude<CliType, (typeof DISPATCHABLE_PROVIDERS)[number]>;
const _providersAreExhaustive: [UnlistedProvider] extends [never] ? true : UnlistedProvider = true;
void _providersAreExhaustive;

/**
 * Hard requirements on whoever runs the packet. Everything here is a *filter*,
 * never a preference — a provider either qualifies or it does not. Soft signals
 * (cost, urgency) live on the packet as `effort` / `priority` so the two can't
 * be confused at the routing seam.
 */
export interface WorkConstraints {
  /**
   * Pin to one CLI. Use only when the work is genuinely CLI-specific; pinning
   * defeats the point of dispatch. The real case today: resuming or querying an
   * existing session, whose CLI is already fixed by how it was spawned
   * (`PtySession.cliType`).
   */
  provider?: CliType;
  /**
   * Capability flags the provider must have. Order is not significant and
   * duplicates are normalized away by `validateWorkPacket`.
   */
  requires?: CapabilityFlag[];
}

// ─── Cost / urgency hints ────────────────────────────────────────────

/**
 * Reasoning effort. Reuses the value space both CLIs already expose via
 * `--effort` / `--reasoning-effort` (`lib/cli/uiMetadata.ts: EFFORT_LEVELS`,
 * `SpawnOptions.effort`), so it maps onto a real flag instead of inventing a
 * private cost scale. `EFFORT_LEVELS`' empty-string "Default" member is
 * intentionally not modelled — an absent field means "provider default".
 *
 * This is the packet's cost lever, and it is the one the codebase already has
 * an opinion about: `ORCHESTRATOR_PROVIDER_PREFERENCE` is ordered
 * cheapest-capable-first precisely because orchestrator work is "many small,
 * internal, mostly-mechanical queries" — i.e. `'low'`.
 */
export const WORK_EFFORTS = ['low', 'medium', 'high'] as const;
export type WorkEffort = (typeof WORK_EFFORTS)[number];

/**
 * Queue ordering hint. Nothing consumes this yet — there is no queue — but a
 * dispatcher's minimum job is deciding what runs first, and the distinction is
 * already visible in the product: a summary is background housekeeping while a
 * Deep Session Search has a human watching a spinner.
 */
export const WORK_PRIORITIES = ['low', 'normal', 'high'] as const;
export type WorkPriority = (typeof WORK_PRIORITIES)[number];

// ─── Origin ──────────────────────────────────────────────────────────

/**
 * Where the work came from. Present whenever there is a real session behind it;
 * absent for work the app invents on its own behalf (orchestrator queries).
 *
 * Provenance and binding are separate concerns: a packet can name its origin
 * for logging and still be freely routable. `requiresOriginSession` is what
 * makes the origin mandatory.
 */
export interface WorkOrigin {
  /** The session whose context the work refers to. */
  sessionId: string;
  /**
   * Working directory the work should be interpreted against. Optional because
   * the runner can usually recover it (`PtyManager.findSessionCwd`, falling
   * back to `process.cwd()` — see `captureQuery`), but carrying it makes the
   * packet self-describing and avoids a lookup that can fail.
   */
  cwd?: string;
}

// ─── The packet ──────────────────────────────────────────────────────

export interface WorkPacket {
  /**
   * Stable, caller-supplied identifier, unique for the life of the dispatch.
   * Not generated here: `randomUUID` lives in `node:crypto`, which this module
   * may not import. Callers already have one to hand — `randomUUID()` in the
   * main process, the `q-<ts>-<rand>` ids `useOrchestrator` mints in the client.
   */
  id: string;

  /** What sort of work this is. See `WORK_KINDS`. */
  kind: WorkKind;

  /**
   * The prompt, fully rendered. Templating happens before the packet exists, so
   * everything downstream sees one canonical string — the same thing
   * `captureQuery` takes today.
   */
  instruction: string;

  /**
   * Short human label for the transparency echo, e.g. "Summary", "Handoff",
   * "Deep search". Feeds `CaptureActivity.label`, which drives the
   * `session:acp-activity` console event so these otherwise-invisible queries
   * stay visible to the user. Optional; a dispatcher can fall back to `kind`.
   */
  label?: string;

  /** Originating session + cwd, when the work has one. */
  origin?: WorkOrigin;

  /**
   * Force the work to run inside `origin.sessionId` rather than anywhere
   * capable. Defaults per-kind via `mustRunInOriginSession` — override it for
   * the case the kind can't express, e.g. a `query` that asks a specific
   * session about its own recent edits.
   */
  requiresOriginSession?: boolean;

  /** Hard provider requirements. See `WorkConstraints`. */
  constraints?: WorkConstraints;

  /**
   * Wall-clock budget. Absent means the per-kind default from
   * `DEFAULT_TIMEOUT_MS_BY_KIND`; resolve it with `resolveTimeoutMs`.
   */
  timeoutMs?: number;

  /** Queue-ordering hint; defaults to `'normal'` via `resolvePriority`. */
  priority?: WorkPriority;

  /** Reasoning-effort hint; absent means the provider default. */
  effort?: WorkEffort;

  /** Epoch ms the packet was created, for queue age and logging. */
  createdAt?: number;
}

// ─── Defaults ────────────────────────────────────────────────────────

/**
 * Per-kind timeouts, each taken from what the corresponding call site passes
 * today rather than picked out of the air:
 *
 *  - `summary` 45s — `SummaryService` passes no options, so it inherits the
 *    45s default shared by `injectPrompt` and `AcpClient.runQuery`.
 *  - `handoff` 90s — `HandoffService` passes `{ timeoutMs: 90000 }`.
 *  - `query`   45s — `queryOrchestrator` passes no options; same 45s default.
 *  - `search`  120s — `ResumeModal` waits 120s for a deep search.
 */
export const DEFAULT_TIMEOUT_MS_BY_KIND: Readonly<Record<WorkKind, number>> = {
  summary: 45_000,
  handoff: 90_000,
  query: 45_000,
  search: 120_000,
};

/**
 * Floor for `timeoutMs`. `injectPrompt` alone spends up to 3s just waiting for
 * the CLI's prompt to become ready before it types anything, so a sub-second
 * budget can only ever expire — it is a caller bug, not a valid request.
 */
export const MIN_TIMEOUT_MS = 1_000;

/**
 * Ceiling for `timeoutMs`. Nothing in the app waits anywhere near this long
 * (the current maximum is the 120s deep search); the bound exists so a
 * mis-scaled value — seconds mistaken for milliseconds, say — is rejected at
 * the seam instead of wedging a dispatcher slot for hours.
 */
export const MAX_TIMEOUT_MS = 600_000;

/** Priority applied when the packet does not state one. */
export const DEFAULT_PRIORITY: WorkPriority = 'normal';

// ─── Result ──────────────────────────────────────────────────────────

/**
 * Why a packet did not produce usable output. Coarse on purpose: these are the
 * failure modes the current code can actually distinguish. Everything in
 * `captureQuery` / `injectPrompt` collapses to `{ success: false, content: '',
 * lines: [] }` today, which is exactly the information loss this union exists
 * to stop.
 */
export type WorkFailureReason =
  | 'invalid_packet'
  | 'no_provider'
  | 'session_unavailable'
  | 'provider_error'
  | 'timeout'
  | 'empty_output';

/**
 * The outcome of running a packet.
 *
 * Structurally a superset of `InjectionResult` (`{ success, content, lines }`),
 * so the existing `captureQuery` return value can be spread straight into one
 * with no adapter. The added fields are the things a dispatcher knows and the
 * runner does not: which packet this answers, who actually ran it, and when.
 *
 * It lives here, next to the packet, because request and response are one
 * contract — but it is a *separate value*, never a mutable field on the packet.
 * See "Deliberately absent" below.
 */
export interface WorkResult {
  /** The `WorkPacket.id` this answers. */
  packetId: string;
  success: boolean;
  /** Raw text output. Mirrors `InjectionResult.content`. */
  content: string;
  /** Output split into lines. Mirrors `InjectionResult.lines`. */
  lines: string[];
  /** Which CLI actually ran it — the answer to "what did dispatch choose?". */
  provider?: CliType;
  /** Session it ran in, when it ran inside one. */
  sessionId?: string;
  /** Set when `success` is false. */
  failure?: WorkFailureReason;
  /** Epoch ms. */
  startedAt?: number;
  /** Epoch ms. */
  finishedAt?: number;
}

/*
 * DELIBERATELY ABSENT — things a dispatcher will need, that do not belong on a
 * packet:
 *
 *  - A mutable `status` ('queued' | 'running' | 'done'). That is queue state
 *    owned by the dispatcher, not a property of the request. Putting it here
 *    would make the packet un-cacheable and un-replayable, and would invite two
 *    copies of the truth across the IPC boundary.
 *  - Retry counts / backoff. `captureQuery` already owns a fallback ladder
 *    (ACP, then the PTY injector). A second, packet-level retry policy would
 *    compound with it invisibly.
 *  - Dependencies between packets (`blocks` / `blockedBy`). `TaskItem` in
 *    `lib/types.ts` already has those, for the *user's* todo lists — a
 *    different domain. Dispatch DAGs are out of scope.
 *  - An output file path. `injectPrompt` derives it from the session id; a path
 *    on the packet would leak a transport detail (and an absolute filesystem
 *    path) into a type the browser bundle imports.
 *  - A pinned `model`. Model id spaces are provider-specific
 *    (`CLAUDE_MODELS` vs `COPILOT_MODELS`), so pinning a model without also
 *    pinning a provider is incoherent, and pinning both is just a spawn config.
 *    `effort` is the portable lever; both CLIs accept it.
 *  - Progress/streaming callbacks. Not JSON-serializable, and the packet has to
 *    cross a socket.
 *  - Money. Nothing in the repo measures tokens or dollars, so any cost field
 *    would be fiction.
 */

// ─── Validation ──────────────────────────────────────────────────────

/**
 * Machine-readable failure category. Kept small and stable so a caller can
 * branch (e.g. retry on `out_of_range` after clamping) rather than regex the
 * message.
 */
export type WorkPacketIssueCode =
  | 'not_an_object'
  | 'missing'
  | 'wrong_type'
  | 'empty'
  | 'unknown_value'
  | 'out_of_range'
  | 'inconsistent';

export interface WorkPacketIssue {
  /** Dotted path to the offending field, e.g. `constraints.requires[1]`.
   *  Empty string means the packet as a whole. */
  path: string;
  code: WorkPacketIssueCode;
  /** Human-readable, actionable, safe to log. */
  message: string;
}

/**
 * Discriminated so a caller cannot read `packet` without having checked `ok` —
 * this is the seam a future dispatcher depends on, and a silent `undefined`
 * packet there would be a routing bug that only shows up at runtime.
 */
export type WorkPacketValidation =
  | { ok: true; packet: WorkPacket }
  | { ok: false; issues: WorkPacketIssue[] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Render a value for an error message without dumping a whole object graph. */
function describeValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === null) return 'null';
  if (Array.isArray(value)) return `an array`;
  if (typeof value === 'object') return 'an object';
  return String(value);
}

function issue(path: string, code: WorkPacketIssueCode, message: string): WorkPacketIssue {
  return { path, code, message };
}

/**
 * Read a required string. Surrounding whitespace is trimmed rather than
 * rejected: these values arrive from templated prompts and text inputs, where
 * stray whitespace is noise, never intent.
 */
function readRequiredString(
  value: unknown,
  path: string,
  issues: WorkPacketIssue[],
): string | undefined {
  if (value === undefined || value === null) {
    issues.push(issue(path, 'missing', `${path} is required.`));
    return undefined;
  }
  if (typeof value !== 'string') {
    issues.push(issue(path, 'wrong_type', `${path} must be a string; received ${describeValue(value)}.`));
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    issues.push(issue(path, 'empty', `${path} must not be empty.`));
    return undefined;
  }
  return trimmed;
}

/** Read an optional string with the same rules; `undefined` stays `undefined`. */
function readOptionalString(
  value: unknown,
  path: string,
  issues: WorkPacketIssue[],
): string | undefined {
  if (value === undefined) return undefined;
  return readRequiredString(value, path, issues);
}

function readEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  issues: WorkPacketIssue[],
): T | undefined {
  if (typeof value !== 'string') {
    issues.push(issue(path, 'wrong_type', `${path} must be a string; received ${describeValue(value)}.`));
    return undefined;
  }
  if (!(allowed as readonly string[]).includes(value)) {
    issues.push(issue(
      path,
      'unknown_value',
      `${path} must be one of ${allowed.join(', ')}; received ${describeValue(value)}.`,
    ));
    return undefined;
  }
  return value as T;
}

/**
 * Validate and normalize unknown input into a `WorkPacket`.
 *
 * Normalization is limited to removing noise, never to inventing intent:
 * strings are trimmed, duplicate capability flags collapse, and empty
 * containers are dropped. Defaults are NOT filled in — `timeoutMs` and
 * `priority` stay absent so "the caller asked for 90s" and "nobody asked, so we
 * used the kind default" remain distinguishable in logs. Use `resolveTimeoutMs`
 * / `resolvePriority` / `mustRunInOriginSession` at the point of use.
 *
 * Unknown extra properties are ignored rather than rejected, because packets
 * cross a version boundary (a client may be newer than the main process it
 * talks to) and an unrecognized hint should degrade, not fail.
 *
 * All issues are collected, not short-circuited: a caller fixing a malformed
 * packet should see everything wrong with it in one pass.
 */
export function validateWorkPacket(input: unknown): WorkPacketValidation {
  if (!isPlainObject(input)) {
    return {
      ok: false,
      issues: [issue('', 'not_an_object', `A work packet must be an object; received ${describeValue(input)}.`)],
    };
  }

  const issues: WorkPacketIssue[] = [];

  const id = readRequiredString(input.id, 'id', issues);

  // `kind` is reported as `missing` rather than `wrong_type` when absent — the
  // distinction is what tells a caller whether they forgot a field or typo'd a
  // value, and it is the first thing a dispatcher branches on.
  let kind: WorkKind | undefined;
  if (input.kind === undefined || input.kind === null) {
    issues.push(issue('kind', 'missing', `kind is required; expected one of ${WORK_KINDS.join(', ')}.`));
  } else {
    kind = readEnum(input.kind, WORK_KINDS, 'kind', issues);
  }

  const instruction = readRequiredString(input.instruction, 'instruction', issues);
  const label = readOptionalString(input.label, 'label', issues);

  // ── origin ──
  let origin: WorkOrigin | undefined;
  if (input.origin !== undefined) {
    if (!isPlainObject(input.origin)) {
      issues.push(issue('origin', 'wrong_type', `origin must be an object; received ${describeValue(input.origin)}.`));
    } else {
      const sessionId = readRequiredString(input.origin.sessionId, 'origin.sessionId', issues);
      const cwd = readOptionalString(input.origin.cwd, 'origin.cwd', issues);
      if (sessionId !== undefined) {
        origin = cwd === undefined ? { sessionId } : { sessionId, cwd };
      }
    }
  }

  // ── requiresOriginSession ──
  let requiresOriginSession: boolean | undefined;
  if (input.requiresOriginSession !== undefined) {
    if (typeof input.requiresOriginSession !== 'boolean') {
      issues.push(issue(
        'requiresOriginSession',
        'wrong_type',
        `requiresOriginSession must be a boolean; received ${describeValue(input.requiresOriginSession)}.`,
      ));
    } else {
      requiresOriginSession = input.requiresOriginSession;
    }
  }

  // ── constraints ──
  let constraints: WorkConstraints | undefined;
  if (input.constraints !== undefined) {
    if (!isPlainObject(input.constraints)) {
      issues.push(issue(
        'constraints',
        'wrong_type',
        `constraints must be an object; received ${describeValue(input.constraints)}.`,
      ));
    } else {
      const rawConstraints = input.constraints;
      const provider = rawConstraints.provider === undefined
        ? undefined
        : readEnum(rawConstraints.provider, DISPATCHABLE_PROVIDERS, 'constraints.provider', issues);

      let requires: CapabilityFlag[] | undefined;
      if (rawConstraints.requires !== undefined) {
        if (!Array.isArray(rawConstraints.requires)) {
          issues.push(issue(
            'constraints.requires',
            'wrong_type',
            `constraints.requires must be an array; received ${describeValue(rawConstraints.requires)}.`,
          ));
        } else {
          const seen = new Set<CapabilityFlag>();
          rawConstraints.requires.forEach((entry, index) => {
            const flag = readEnum(entry, CAPABILITY_FLAGS, `constraints.requires[${index}]`, issues);
            if (flag !== undefined) seen.add(flag);
          });
          requires = [...seen];
        }
      }

      const normalized: WorkConstraints = {};
      if (provider !== undefined) normalized.provider = provider;
      if (requires !== undefined) normalized.requires = requires;
      // Drop `constraints: {}` — an empty constraint block says nothing.
      if (Object.keys(normalized).length > 0) constraints = normalized;
    }
  }

  // ── timeoutMs ──
  let timeoutMs: number | undefined;
  if (input.timeoutMs !== undefined) {
    const value = input.timeoutMs;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      issues.push(issue('timeoutMs', 'wrong_type', `timeoutMs must be a finite number; received ${describeValue(value)}.`));
    } else if (!Number.isInteger(value)) {
      issues.push(issue('timeoutMs', 'wrong_type', `timeoutMs must be a whole number of milliseconds; received ${value}.`));
    } else if (value < MIN_TIMEOUT_MS || value > MAX_TIMEOUT_MS) {
      issues.push(issue(
        'timeoutMs',
        'out_of_range',
        `timeoutMs must be between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}; received ${value}.`,
      ));
    } else {
      timeoutMs = value;
    }
  }

  // ── priority / effort ──
  const priority = input.priority === undefined
    ? undefined
    : readEnum(input.priority, WORK_PRIORITIES, 'priority', issues);
  const effort = input.effort === undefined
    ? undefined
    : readEnum(input.effort, WORK_EFFORTS, 'effort', issues);

  // ── createdAt ──
  let createdAt: number | undefined;
  if (input.createdAt !== undefined) {
    const value = input.createdAt;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      issues.push(issue('createdAt', 'wrong_type', `createdAt must be a finite number; received ${describeValue(value)}.`));
    } else if (value < 0) {
      issues.push(issue('createdAt', 'out_of_range', `createdAt must be a non-negative epoch-ms timestamp; received ${value}.`));
    } else {
      createdAt = value;
    }
  }

  // ── cross-field rules ──
  // Session-bound kinds read the originating conversation; without it there is
  // nothing to summarize or hand off, which is why both services return early
  // when the session is missing. Catch it here instead of at the PTY.
  if (kind !== undefined && SESSION_BOUND_KINDS.includes(kind) && origin?.sessionId === undefined) {
    issues.push(issue(
      'origin.sessionId',
      'inconsistent',
      `kind '${kind}' reads the originating session's context, so origin.sessionId is required.`,
    ));
  }
  if (requiresOriginSession === true && origin?.sessionId === undefined) {
    issues.push(issue(
      'origin.sessionId',
      'inconsistent',
      'requiresOriginSession is true, so origin.sessionId is required.',
    ));
  }

  if (issues.length > 0 || id === undefined || kind === undefined || instruction === undefined) {
    return { ok: false, issues };
  }

  const packet: WorkPacket = { id, kind, instruction };
  if (label !== undefined) packet.label = label;
  if (origin !== undefined) packet.origin = origin;
  if (requiresOriginSession !== undefined) packet.requiresOriginSession = requiresOriginSession;
  if (constraints !== undefined) packet.constraints = constraints;
  if (timeoutMs !== undefined) packet.timeoutMs = timeoutMs;
  if (priority !== undefined) packet.priority = priority;
  if (effort !== undefined) packet.effort = effort;
  if (createdAt !== undefined) packet.createdAt = createdAt;

  return { ok: true, packet };
}

/**
 * Type guard for call sites that only need yes/no. Prefer `validateWorkPacket`
 * anywhere the failure should be reported — the issues are the useful part.
 */
export function isWorkPacket(input: unknown): input is WorkPacket {
  return validateWorkPacket(input).ok;
}

// ─── Defaulting helpers ──────────────────────────────────────────────

/** The budget to actually run with: explicit value, else the per-kind default. */
export function resolveTimeoutMs(packet: WorkPacket): number {
  return packet.timeoutMs ?? DEFAULT_TIMEOUT_MS_BY_KIND[packet.kind];
}

/** The ordering hint to actually use: explicit value, else `'normal'`. */
export function resolvePriority(packet: WorkPacket): WorkPriority {
  return packet.priority ?? DEFAULT_PRIORITY;
}

/**
 * Whether the work has to run inside `origin.sessionId`. An explicit flag wins;
 * otherwise it follows from the kind (see `SESSION_BOUND_KINDS`). Setting the
 * flag to `false` on a summary is honoured — the packet author is assumed to
 * know something the kind doesn't — so this is an override, not a floor.
 */
export function mustRunInOriginSession(packet: WorkPacket): boolean {
  return packet.requiresOriginSession ?? SESSION_BOUND_KINDS.includes(packet.kind);
}

/** Capability flags a packet demands. Never undefined, so callers can iterate. */
export function requiredCapabilities(packet: WorkPacket): CapabilityFlag[] {
  return packet.constraints?.requires ?? [];
}

// ─── Provider fit ────────────────────────────────────────────────────

/** The client-safe slice of a `CliProvider`: its identity and its flags. */
export type ProviderCapabilities = { [K in CapabilityFlag]: boolean };

export interface ProviderProfile extends ProviderCapabilities {
  type: CliType;
}

/**
 * Project a real provider down to a serializable profile.
 *
 * Exists because `CliProvider` implementations pull in `fs`/`child_process` at
 * module load, so the client can never hold one — but the client (and any
 * dispatcher running across the IPC boundary) still needs to know what a
 * provider can do. `Pick` keeps this structurally tied to the interface.
 */
export function capabilityProfile(
  provider: Pick<CliProvider, 'type' | CapabilityFlag>,
): ProviderProfile {
  const profile = { type: provider.type } as ProviderProfile;
  for (const flag of CAPABILITY_FLAGS) profile[flag] = provider[flag];
  return profile;
}

export interface ProviderEligibility {
  eligible: boolean;
  /** Declared capabilities this provider lacks. Empty when it qualifies. */
  missingCapabilities: CapabilityFlag[];
  /** True when the packet pins a different provider than the one offered. */
  pinnedProviderMismatch: boolean;
}

/**
 * Can this one provider satisfy this packet's hard constraints?
 *
 * NOTE ON SCOPE: this deliberately answers only "does candidate X qualify",
 * with no notion of ranking, fallback, or choosing between candidates — that is
 * the dispatcher's job and is not built here. It lives beside the validator
 * because it is the same kind of question (is this request satisfiable?) and
 * because without it `WorkConstraints` would be a field nothing can read.
 */
export function checkProviderEligibility(
  packet: WorkPacket,
  profile: ProviderProfile,
): ProviderEligibility {
  const pinned = packet.constraints?.provider;
  const pinnedProviderMismatch = pinned !== undefined && pinned !== profile.type;
  const missingCapabilities = requiredCapabilities(packet).filter(flag => !profile[flag]);
  return {
    eligible: !pinnedProviderMismatch && missingCapabilities.length === 0,
    missingCapabilities,
    pinnedProviderMismatch,
  };
}
