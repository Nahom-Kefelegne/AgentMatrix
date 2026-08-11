export const NAVIGATION_PROTOCOL_VERSION = 'agentmatrix.navigation/v1' as const;

export type NavigationAction =
  | 'open_file'
  | 'reveal_range'
  // Retained only so stale clients receive an explicit disabled response.
  | 'open_symbol'
  | 'show_search_results'
  | 'open_diff'
  | 'open_review';

export function isRepositorySearchAction(
  action: unknown,
): action is 'open_symbol' | 'show_search_results' {
  return action === 'open_symbol' || action === 'show_search_results';
}

export type NavigationSource = 'developer' | 'terminal_link' | 'mcp' | 'session_event';
export type NavigationDisposition = 'queue' | 'preview' | 'pinned';
export type NavigationFocus = 'preserve' | 'canvas';

export interface SourcePosition {
  /** 1-based line. */
  line: number;
  /** 1-based column. */
  column?: number;
}

export interface SourceRange {
  start: SourcePosition;
  /** Exclusive end position. */
  end?: SourcePosition;
}

export interface NavigationTarget {
  /** Repository-root-relative POSIX path. */
  path: string;
  range?: SourceRange;
  symbol?: string;
  /** Optional Markdown heading fragment without the leading '#'. */
  fragment?: string;
}

export interface NavigationPresentation {
  disposition?: NavigationDisposition;
  focus?: NavigationFocus;
}

export interface NavigationIntent {
  kind: 'explicit_user_request' | 'agent_progress' | 'developer_link';
  summary: string;
  originMessageRef?: string;
  originToolCallRef?: string;
}

export type DiffSourceKind =
  | 'turn'
  | 'session'
  | 'working_tree'
  | 'branch'
  | 'worktree'
  | 'checkpoint';

export interface DiffRequest {
  source: DiffSourceKind;
  sessionId?: string;
  turnRef?: string;
  checkpointRef?: string;
  baseRef?: string;
  compareRef?: string;
  filterPaths?: string[];
  view?: 'inline' | 'split';
}

export interface NavigationRequest {
  protocolVersion: typeof NAVIGATION_PROTOCOL_VERSION;
  requestRef: string;
  sessionId: string;
  repoRef?: string;
  worktreeRef?: string;
  action: NavigationAction;
  source: NavigationSource;
  target?: NavigationTarget;
  query?: string;
  symbolKind?: string;
  diff?: DiffRequest;
  presentation?: NavigationPresentation;
  intent: NavigationIntent;
  createdAt: number;
}

export type NavigationStatus =
  | 'shown'
  | 'queued'
  | 'suppressed'
  | 'needs_user_choice'
  | 'rejected'
  | 'stale'
  | 'failed';

export interface NavigationError {
  code: string;
  message: string;
  recovery?: string;
}

export interface NavigationResult {
  requestRef: string;
  sessionId: string;
  status: NavigationStatus;
  target?: NavigationTarget;
  dispositionApplied?: NavigationDisposition;
  focusApplied?: NavigationFocus;
  error?: NavigationError;
}

export interface NavigationFile {
  sessionId: string;
  repoRef: string;
  path: string;
  content: string;
  language: string;
  mtimeMs: number;
  size: number;
  range?: SourceRange;
}

export interface NavigationSearchMatch {
  path: string;
  line: number;
  column?: number;
  preview: string;
  matchText?: string;
}

export interface NavigationSearchResponse {
  sessionId: string;
  repoRef: string;
  query: string;
  matches: NavigationSearchMatch[];
  truncated: boolean;
  indexVersion: string;
  durationMs: number;
}

export interface NavigationSymbolMatch extends NavigationSearchMatch {
  name: string;
  kind?: string;
}

export interface NavigationHistoryEntry {
  id: string;
  sessionId: string;
  action: NavigationAction;
  target?: NavigationTarget;
  query?: string;
  diff?: DiffRequest;
  origin?: NavigationIntent;
  createdAt: number;
}

export type CanvasMode = 'closed' | 'code' | 'document' | 'diff' | 'review';

export interface CanvasState {
  mode: CanvasMode;
  disposition: NavigationDisposition;
  request: NavigationRequest | null;
  history: NavigationHistoryEntry[];
  historyIndex: number;
  loading: boolean;
  error: NavigationError | null;
}

export type DiffAttributionConfidence =
  | 'tool_patch_verified'
  | 'observed_during_session'
  | 'working_tree_unattributed'
  | 'stale';

export interface DiffSourceDescriptor {
  source: DiffSourceKind;
  sessionId?: string;
  turnRef?: string;
  baseRef?: string;
  compareRef?: string;
  worktreeRef?: string;
  capturedAt: number;
  freshness: 'current' | 'stale' | 'unknown';
  confidence: DiffAttributionConfidence;
}

export interface ReviewAnchor {
  path: string;
  side: 'old' | 'new' | 'file';
  range: SourceRange;
  snapshot: {
    kind: DiffSourceKind;
    snapshotRef: string;
    fileHash: string;
  };
}

export interface ReviewFeedback {
  feedbackRef: string;
  sessionId: string;
  repoRef: string;
  anchor: ReviewAnchor;
  body: string;
  delivery: 'steer_if_running_else_queue' | 'queue';
  createdAt: number;
}
