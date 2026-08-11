export type CliType = 'claude' | 'copilot';

export interface CliHealth {
  type: CliType;
  installed: boolean;
  version: string | null;
  binaryPath: string | null;
  error?: string;
}

export interface SpawnOptions {
  cwd: string;
  sessionId?: string;
  /** Human-readable session name. Copilot persists this via `-n`. */
  name?: string;
  permissionMode?: string;
  model?: string;
  effort?: string;
  allowedTools?: string;
  systemPrompt?: string;
  // Copilot-specific
  copilotMode?: string;  // 'interactive' | 'plan' | 'autopilot'
}

export interface ResumeOptions {
  cwd: string;
  resumeId: string;
  fork?: boolean;
  permissionMode?: string;
  model?: string;
  effort?: string;
  allowedTools?: string;
  copilotMode?: string;
}

/** A session discovered on disk (not necessarily running). */
export interface DiscoveredSession {
  id: string;
  cwd?: string;
  name?: string;
  /** Absolute path to the primary transcript file, when applicable. */
  transcriptPath?: string;
  /** UNIX ms timestamp of last modification, for sorting. */
  lastModified?: number;
}

/** A running CLI process detected via `ps`. */
export interface ActiveProcessInfo {
  sessionId: string;
  resumeName?: string;
}

export interface PermissionMode {
  value: string;
  label: string;
  desc: string;
}

/**
 * Abstracts the differences between supported CLI agents (Claude Code,
 * GitHub Copilot CLI). Anything CLI-specific should live behind this
 * interface so callers can ask the provider rather than branching on
 * `cliType`.
 */
export interface CliProvider {
  readonly type: CliType;
  readonly configDir: string;
  readonly displayName: string;
  readonly iconSvg: string;
  readonly iconColor: string;

  // ─── Capability flags ────────────────────────────────────────────
  /** Accepts an MCP-aware system prompt injection. */
  readonly supportsMcp: boolean;
  /** Supports forking a session from an existing one (--fork-session). */
  readonly supportsFork: boolean;
  /** Prints context usage in its TUI in a parseable form. */
  readonly supportsContextTracking: boolean;
  /** Can spawn subagents that emit SubagentStart/SubagentStop hooks. */
  readonly supportsSubagents: boolean;
  /** Offers an Agent Client Protocol (ACP) stdio mode. */
  readonly supportsAcp: boolean;

  // ─── Binary + health ─────────────────────────────────────────────
  findBinary(): string;
  checkHealth(): CliHealth;

  // ─── Spawn / resume ──────────────────────────────────────────────
  buildSpawnArgs(opts: SpawnOptions): string[];
  buildResumeArgs(opts: ResumeOptions): string[];
  /**
   * Build a copy-pasteable shell command to resume a session from a
   * terminal. Used by "copy resume command" UI affordances.
   */
  buildResumeShellCommand(opts: ResumeOptions): string;

  /**
   * The keystroke sequence that cleanly exits an interactive session (fires
   * the CLI's SessionEnd hook, flushes the transcript, releases locks).
   * Returned as ordered steps because some CLIs need multiple presses with a
   * gap between them. Callers write each `data` then wait `delayMs` before the
   * next. Verified per-CLI:
   *   - Claude: `/exit` + Enter.
   *   - Copilot: Ctrl-C twice (its TUI ignores `/exit`; two SIGINT keystrokes
   *     trigger graceful shutdown and remove the inuse lock).
   */
  getExitSequence(): Array<{ data: string; delayMs: number }>;

  // ─── TUI parsing ─────────────────────────────────────────────────
  detectPromptReady(text: string): boolean;
  /** Detect the first complete interactive screen after spawn or resume. */
  detectStartupReady(text: string): boolean;
  /**
   * Parse context-window usage (% used, 0-100) from a chunk of TUI output.
   * Used for CLIs that print usage in their terminal (Claude). CLIs that don't
   * (Copilot) return null here and implement `getContextUsage` instead.
   */
  parseContextUsage(text: string): number | null;
  /**
   * Compute context-window usage (% used, 0-100) for a session from the CLI's
   * own on-disk state, rather than the TUI text stream. Used for Copilot
   * (reads token accounting from session-store.db). Returns null when
   * unavailable (e.g. Claude, which uses `parseContextUsage`, or when the data
   * can't be read). Must not block — implementations run off the main thread.
   */
  getContextUsage(sessionId: string): Promise<number | null>;
  /**
   * Substrings indicating the CLI is asking to confirm workspace/folder
   * trust on first launch. The watcher sends Enter to auto-accept.
   */
  getTrustPromptPatterns(): string[];
  /**
   * Substrings indicating the CLI is asking how to handle a large/old
   * conversation on resume (compact, continue, start fresh). The watcher
   * sends Enter to pick the default ("continue as-is").
   */
  getContextPromptPatterns(): string[];

  // ─── UI metadata ─────────────────────────────────────────────────
  getModelList(): Array<{ value: string; label: string }>;
  getPermissionModes(): PermissionMode[];

  // ─── Session discovery on disk ───────────────────────────────────
  /** List all sessions persisted on disk for this CLI. */
  discoverSessions(): DiscoveredSession[];
  /** Look up the original working directory for a given session ID. */
  findSessionCwd(sessionId: string): string | undefined;
  /** Read the provider's authoritative persisted session name. */
  findSessionName(sessionId: string): string | undefined;

  /**
   * Absolute path to the session's on-disk transcript / event log, or undefined
   * if it can't be located. This is the CLI's authoritative record of the
   * agent's actions (used by the native change detector to derive per-session
   * diffs). Copilot: `session-state/<id>/events.jsonl`. Claude:
   * `projects/<project>/<id>.jsonl`.
   */
  getTranscriptPath(sessionId: string): string | undefined;

  /**
   * Persist a new display name for a session at the CLI's own storage layer,
   * so the rename survives resume/discovery. Returns true if the provider
   * handled the rename on disk.
   *
   * - Copilot: writes `name`/`user_named` into the session's workspace.yaml.
   * - Claude: no-op (renaming is done in-TUI via the `/rename` command, which
   *   the client injects into the PTY; the name lives in the transcript).
   */
  renameSession(sessionId: string, newName: string): boolean;

  // ─── Process detection ───────────────────────────────────────────
  /**
   * Scan running processes for active sessions belonging to this CLI.
   * Used by the periodic session scanner and the OrphanReaper.
   */
  detectActiveSessionIds(): ActiveProcessInfo[];
}
