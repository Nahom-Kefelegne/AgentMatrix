import type { CanvasRequest } from './types';

const MAX_SESSIONS = 64;
const MAX_REQUESTS_PER_SESSION = 50;
const MAX_BYTES_PER_SESSION = 1024 * 1024;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const REQUEST_TTL_MS = 24 * 60 * 60 * 1_000;

const globalStore = globalThis as typeof globalThis & {
  __agentMatrixCanvasRequests?: Map<string, CanvasRequest[]>;
};

const requestsBySession = globalStore.__agentMatrixCanvasRequests
  ?? (globalStore.__agentMatrixCanvasRequests = new Map<string, CanvasRequest[]>());

function requestBytes(request: CanvasRequest): number {
  return Buffer.byteLength(JSON.stringify(request), 'utf8');
}

function trimSession(requests: CanvasRequest[], now = Date.now()): CanvasRequest[] {
  const retained = requests.filter(request => now - request.createdAt < REQUEST_TTL_MS);
  let bytes = retained.reduce((total, request) => total + requestBytes(request), 0);
  while (
    retained.length > MAX_REQUESTS_PER_SESSION
    || (bytes > MAX_BYTES_PER_SESSION && retained.length > 1)
  ) {
    bytes -= requestBytes(retained.shift()!);
  }
  return retained;
}

function trimStore(): void {
  const now = Date.now();
  for (const [sessionId, requests] of requestsBySession) {
    const retained = trimSession(requests, now);
    if (retained.length === 0) requestsBySession.delete(sessionId);
    else requestsBySession.set(sessionId, retained);
  }

  const totalBytes = () => Array.from(requestsBySession.values())
    .flat()
    .reduce((total, request) => total + requestBytes(request), 0);
  while (requestsBySession.size > MAX_SESSIONS || totalBytes() > MAX_TOTAL_BYTES) {
    const oldest = requestsBySession.keys().next().value as string | undefined;
    if (!oldest) break;
    requestsBySession.delete(oldest);
  }
}

export function retainCanvasRequest(request: CanvasRequest): void {
  const current = requestsBySession.get(request.sessionId) ?? [];
  const replaceKind = ['code', 'changes', 'plan', 'decision'].includes(request.kind);
  const retained = current.filter(item =>
    item.requestRef !== request.requestRef
    && (!replaceKind || item.kind !== request.kind),
  );
  const next = trimSession([...retained, request]);

  // Refresh insertion order so the outer map also behaves as a bounded LRU.
  requestsBySession.delete(request.sessionId);
  requestsBySession.set(request.sessionId, next);
  trimStore();
}

export function getCanvasRequestSnapshot(): CanvasRequest[] {
  trimStore();
  return Array.from(requestsBySession.values()).flat();
}

export function clearCanvasRequests(sessionId: string): void {
  requestsBySession.delete(sessionId);
}
