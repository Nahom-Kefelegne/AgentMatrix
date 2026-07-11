/**
 * Shared types for the native, transcript-based change detector.
 *
 * Instead of shelling out to `git diff HEAD` over a hook-collected file list
 * (which conflates the session's edits with all other uncommitted repo changes,
 * requires a git repo, and depends on a fragile hook field mapping), we read
 * each CLI's own on-disk session transcript — the authoritative record of what
 * the agent did — and reconstruct per-session diffs from it. See
 * docs/design/native-diff-tracking.md.
 */

/** A single file-mutating tool call, normalized across CLIs. */
export type FileOpKind = 'create' | 'edit' | 'delete';

export interface FileOp {
  /** Absolute path to the file the op touched. */
  path: string;
  kind: FileOpKind;
  /** The CLI's tool-call id, used to pair start↔complete and drop failures. */
  toolCallId?: string;
  /** UNIX ms timestamp when the op ran (for stable ordering). */
  ts?: number;
  /** For `create`: the full new file content. */
  content?: string;
  /** For `edit`: the exact substring that was replaced. */
  oldStr?: string;
  /** For `edit`: the replacement substring. */
  newStr?: string;
  /** For `edit`: whether all occurrences were replaced (vs. the first). */
  replaceAll?: boolean;
}

/** Per-file summary row for the changes list (matches the API contract). */
export interface FileChange {
  /** Absolute path. */
  path: string;
  status: 'new' | 'modified' | 'deleted';
  additions: number;
  deletions: number;
}

/** Full before/after for a single file (feeds Monaco's DiffEditor). */
export interface FileDiff {
  file: string;
  original: string;
  current: string;
  isNew: boolean;
}
