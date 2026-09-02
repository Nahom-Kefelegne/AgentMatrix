import type React from 'react';
import type { ReviewComment } from '@/lib/types';

// A single changed file entry returned by /api/sessions/changes.
export interface FileChange {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  fileId?: string;
  reason?: string;
  previousPath?: string;
  contentAvailable?: boolean;
  contentKind?: 'text' | 'gitlink';
  unavailableReason?: string;
}

// The raw diff payload for a single file.
export interface FileDiff {
  original: string;
  current: string;
  isNew: boolean;
  contentAvailable?: boolean;
  unavailableReason?: string;
  snapshotRef?: string;
  originalHash?: string;
  currentHash?: string;
}

export type DiffMode = 'inline' | 'split';

// How the core is being rendered by its parent. 'modal' is the legacy
// fixed-position overlay (owned by the wrapper); 'embedded' is a panel that
// fills whatever container the Canvas/parent gives it.
export type DiffPresentation = 'embedded' | 'modal';

export type ReviewSendMode = 'fix' | 'discuss';

// A typed anchor describing where a review comment/selection is attached.
// Surfaced to parents so a future structured-feedback service can consume it
// without depending on the terminal-injection behavior.
export interface CommentAnchor {
  filePath: string;
  startLine: number;
  endLine: number;
}

// Floating comment popover state (add a new comment or view an existing one).
export interface FloatingPopover {
  mode: 'add' | 'view';
  side?: 'original' | 'current';
  line: number;
  endLine: number;
  x: number;
  y: number;
  comment?: ReviewComment;
}

// Callback contract exposed by SessionDiffCore. Every callback is optional so
// the core degrades gracefully when embedded in contexts that don't wire them.
export interface SessionDiffCoreCallbacks {
  // Open the currently-selected file as a full (non-diff) file view elsewhere.
  onOpenFullFile?: (anchor: CommentAnchor) => void;
  // Ask the parent to switch its surface to the console/terminal view.
  onSwitchToConsole?: () => void;
  // Optional close affordance. When provided the core renders a close control.
  onClose?: () => void;
  // Send all unresolved review comments to the agent. Terminal-injection and
  // review-file behavior lives in the parent (wrapper) until the structured
  // feedback service is integrated.
  onSendReviewAll?: (comments: ReviewComment[], mode: ReviewSendMode) => void | Promise<void>;
  // Send a single review comment to the agent.
  onSendReviewComment?: (comment: ReviewComment, mode: ReviewSendMode) => void | Promise<void>;
}

// Comment data + mutations. Returned by useComments and accepted by
// SessionDiffCore so a parent (e.g. the modal wrapper) can share a single
// comment source of truth across multiple surfaces (changes + browse).
export interface CommentsController {
  comments: ReviewComment[];
  setComments: React.Dispatch<React.SetStateAction<ReviewComment[]>>;
  reload: () => void;
  addComment: (
    filePath: string,
    lineNumber: number,
    text: string,
    anchor?: {
      snapshotRef?: string;
      side?: 'original' | 'current';
      startLine?: number;
      endLine?: number;
      contentHash?: string;
      contextExcerpt?: string;
    },
  ) => void | Promise<void>;
  deleteComment: (commentId: string) => void | Promise<void>;
  resolveComment: (commentId: string) => void | Promise<void>;
  resolveAll: () => void | Promise<void>;
  error?: string | null;
}

export type { ReviewComment };
