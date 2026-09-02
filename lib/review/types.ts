import type {
  ReviewFileEntry,
  ReviewSnapshotMeta,
} from '@/lib/canvas/types';

export const MAX_REVIEW_FILE_BYTES = 2 * 1024 * 1024;

export interface ReviewFileInput {
  path: string;
  reason?: string;
}

export interface ReviewSnapshotFile {
  entry: ReviewFileEntry;
  original: string;
  current: string;
  originalHash: string;
  currentHash: string;
}

export interface ReviewSnapshot {
  sessionId: string;
  meta: ReviewSnapshotMeta;
  files: ReviewSnapshotFile[];
}

export interface ReviewFilePayload {
  fileId: string;
  path: string;
  original: string;
  current: string;
  isNew: boolean;
  status: ReviewFileEntry['status'];
  contentAvailable: boolean;
  contentKind?: ReviewFileEntry['contentKind'];
  unavailableReason?: ReviewFileEntry['unavailableReason'];
  snapshotRef: string;
  originalHash: string;
  currentHash: string;
}
