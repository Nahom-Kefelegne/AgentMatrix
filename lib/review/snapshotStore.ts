import { createHash, randomUUID } from 'crypto';
import type {
  ReviewFilePayload,
  ReviewSnapshot,
  ReviewSnapshotFile,
} from './types';

export class ReviewSnapshotStoreError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ReviewSnapshotStoreError';
  }
}

const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_GLOBAL_BYTES = 96 * 1024 * 1024;
const MAX_SNAPSHOTS = 128;
const MAX_SNAPSHOTS_PER_SESSION = 10;
const LEASE_TTL_MS = 2 * 60 * 1_000;

interface BlobRecord {
  content: string;
  bytes: number;
  references: number;
}

interface StoredFile {
  entry: ReviewSnapshotFile['entry'];
  originalHash: string;
  currentHash: string;
}

interface StoredSnapshot {
  sessionId: string;
  meta: ReviewSnapshot['meta'];
  files: StoredFile[];
  leases: Map<string, number>;
  lastAccessedAt: number;
}

interface ReviewStore {
  snapshots: Map<string, StoredSnapshot>;
  blobs: Map<string, BlobRecord>;
  sessionGenerations: Map<string, number>;
}

const globalStore = globalThis as typeof globalThis & {
  __agentMatrixReviewStore?: ReviewStore;
};

const store: ReviewStore = globalStore.__agentMatrixReviewStore ??= {
  snapshots: new Map(),
  blobs: new Map(),
  sessionGenerations: new Map(),
};
for (const snapshot of store.snapshots.values()) {
  if (!(snapshot.leases instanceof Map)) snapshot.leases = new Map();
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function blobBytes(): number {
  let total = 0;
  for (const blob of store.blobs.values()) total += blob.bytes;
  return total;
}

function releaseBlob(hash: string): void {
  const blob = store.blobs.get(hash);
  if (!blob) return;
  blob.references -= 1;
  if (blob.references <= 0) store.blobs.delete(hash);
}

function removeSnapshot(snapshotRef: string): void {
  const snapshot = store.snapshots.get(snapshotRef);
  if (!snapshot) return;
  for (const file of snapshot.files) {
    releaseBlob(file.originalHash);
    releaseBlob(file.currentHash);
  }
  store.snapshots.delete(snapshotRef);
}

export function discardReviewSnapshot(snapshotRef: string): void {
  removeSnapshot(snapshotRef);
}

function cleanupExpired(now = Date.now()): void {
  for (const [snapshotRef, snapshot] of store.snapshots) {
    for (const [leaseId, expiresAt] of snapshot.leases) {
      if (expiresAt <= now) snapshot.leases.delete(leaseId);
    }
    if (
      snapshot.leases.size === 0
      && now - snapshot.meta.capturedAt >= SNAPSHOT_TTL_MS
    ) {
      removeSnapshot(snapshotRef);
    }
  }
}

function evictForBudget(protectedRef: string): void {
  cleanupExpired();
  const protectedSnapshot = store.snapshots.get(protectedRef);
  if (!protectedSnapshot) return;
  const sessionSnapshots = () => Array.from(store.snapshots.entries())
    .filter(([, snapshot]) =>
      snapshot.sessionId === protectedSnapshot.sessionId);
  while (sessionSnapshots().length > MAX_SNAPSHOTS_PER_SESSION) {
    const candidate = sessionSnapshots()
      .filter(([snapshotRef, snapshot]) =>
        snapshotRef !== protectedRef && snapshot.leases.size === 0)
      .sort((left, right) => left[1].lastAccessedAt - right[1].lastAccessedAt)[0];
    if (!candidate) {
      removeSnapshot(protectedRef);
      throw new ReviewSnapshotStoreError(
        'REVIEW_SNAPSHOT_CAPACITY',
        'This session has too many active review snapshots.',
        503,
      );
    }
    removeSnapshot(candidate[0]);
  }

  const overGlobalLimit = () =>
    blobBytes() > MAX_GLOBAL_BYTES || store.snapshots.size > MAX_SNAPSHOTS;
  if (!overGlobalLimit()) return;
  const globalCandidates = Array.from(store.snapshots.entries())
    .filter(([snapshotRef, snapshot]) =>
      snapshotRef !== protectedRef && snapshot.leases.size === 0)
    .sort((left, right) => left[1].lastAccessedAt - right[1].lastAccessedAt);
  for (const [snapshotRef] of globalCandidates) {
    removeSnapshot(snapshotRef);
    if (!overGlobalLimit()) return;
  }
  if (overGlobalLimit()) {
    removeSnapshot(protectedRef);
    throw new ReviewSnapshotStoreError(
      'REVIEW_SNAPSHOT_CAPACITY',
      'Review snapshot storage is temporarily full.',
      503,
    );
  }
}

function retainBlob(content: string): string {
  const hash = hashContent(content);
  const existing = store.blobs.get(hash);
  if (existing) {
    existing.references += 1;
  } else {
    store.blobs.set(hash, {
      content,
      bytes: Buffer.byteLength(content, 'utf8'),
      references: 1,
    });
  }
  return hash;
}

export function reviewSessionGeneration(sessionId: string): number {
  return store.sessionGenerations.get(sessionId) ?? 0;
}

export function retainReviewSnapshot(
  snapshot: ReviewSnapshot,
  generation: number,
): void {
  if (reviewSessionGeneration(snapshot.sessionId) !== generation) {
    throw new ReviewSnapshotStoreError(
      'SESSION_ENDED',
      'The managed session ended before review capture completed.',
      410,
    );
  }
  const files = snapshot.files.map(file => ({
    entry: file.entry,
    originalHash: retainBlob(file.original),
    currentHash: retainBlob(file.current),
  }));
  store.snapshots.set(snapshot.meta.snapshotRef, {
    sessionId: snapshot.sessionId,
    meta: snapshot.meta,
    files,
    leases: new Map(),
    lastAccessedAt: Date.now(),
  });
  try {
    evictForBudget(snapshot.meta.snapshotRef);
  } catch (error) {
    removeSnapshot(snapshot.meta.snapshotRef);
    throw error;
  }
}

export function acquireReviewSnapshot(
  sessionId: string,
  snapshotRef: string,
): string | null {
  cleanupExpired();
  const snapshot = store.snapshots.get(snapshotRef);
  if (!snapshot || snapshot.sessionId !== sessionId) return null;
  const leaseId = randomUUID();
  snapshot.leases.set(leaseId, Date.now() + LEASE_TTL_MS);
  snapshot.lastAccessedAt = Date.now();
  return leaseId;
}

export function renewReviewSnapshotLease(
  sessionId: string,
  snapshotRef: string,
  leaseId: string,
): boolean {
  const snapshot = store.snapshots.get(snapshotRef);
  if (
    !snapshot
    || snapshot.sessionId !== sessionId
    || !snapshot.leases.has(leaseId)
  ) {
    return false;
  }
  snapshot.leases.set(leaseId, Date.now() + LEASE_TTL_MS);
  snapshot.lastAccessedAt = Date.now();
  return true;
}

export function releaseReviewSnapshot(
  sessionId: string,
  snapshotRef: string,
  leaseId: string,
): void {
  const snapshot = store.snapshots.get(snapshotRef);
  if (!snapshot || snapshot.sessionId !== sessionId) return;
  snapshot.leases.delete(leaseId);
  snapshot.lastAccessedAt = Date.now();
}

export function getReviewSnapshotFile(
  sessionId: string,
  fileId: string,
): ReviewFilePayload | null {
  cleanupExpired();
  for (const snapshot of store.snapshots.values()) {
    if (snapshot.sessionId !== sessionId) continue;
    const file = snapshot.files.find(candidate => candidate.entry.fileId === fileId);
    if (!file) continue;
    snapshot.lastAccessedAt = Date.now();
    const original = store.blobs.get(file.originalHash)?.content;
    const current = store.blobs.get(file.currentHash)?.content;
    if (original === undefined || current === undefined) return null;
    return {
      fileId,
      path: file.entry.path,
      original,
      current,
      isNew: file.entry.status === 'added',
      status: file.entry.status,
      contentAvailable: file.entry.contentAvailable,
      contentKind: file.entry.contentKind,
      unavailableReason: file.entry.unavailableReason,
      snapshotRef: snapshot.meta.snapshotRef,
      originalHash: file.originalHash,
      currentHash: file.currentHash,
    };
  }
  return null;
}

export function getReviewSnapshot(
  sessionId: string,
  snapshotRef: string,
): StoredSnapshot | null {
  cleanupExpired();
  const snapshot = store.snapshots.get(snapshotRef);
  if (!snapshot || snapshot.sessionId !== sessionId) return null;
  snapshot.lastAccessedAt = Date.now();
  return snapshot;
}

export function hasReviewSnapshot(
  sessionId: string,
  snapshotRef: string,
): boolean {
  return getReviewSnapshot(sessionId, snapshotRef) !== null;
}

export function getReviewSnapshotStatusSource(
  sessionId: string,
  snapshotRef: string,
): Array<{
  path: string;
  currentHash: string;
  contentAvailable: boolean;
  contentKind?: 'text' | 'gitlink';
}> | null {
  const snapshot = getReviewSnapshot(sessionId, snapshotRef);
  if (!snapshot) return null;
  return snapshot.files.map(file => ({
    path: file.entry.path,
    currentHash: file.currentHash,
    contentAvailable: file.entry.contentAvailable,
    contentKind: file.entry.contentKind,
  }));
}

export function clearReviewSnapshots(sessionId: string): void {
  store.sessionGenerations.set(
    sessionId,
    reviewSessionGeneration(sessionId) + 1,
  );
  for (const [snapshotRef, snapshot] of store.snapshots) {
    if (snapshot.sessionId === sessionId) removeSnapshot(snapshotRef);
  }
}
