// Tiny client-side cache for GET-JSON requests whose results are static-ish
// (e.g. the MCP registry, installed MCP config). Repeatedly opening the session
// dialog / side panel used to re-hit these endpoints every time; caching by URL
// with a short TTL — plus in-flight de-duplication — makes repeat opens instant
// and avoids request storms. Invalidate a URL after a mutation that changes it.

type Entry = { ts: number; data: unknown; inflight?: Promise<unknown> };

const cache = new Map<string, Entry>();

/**
 * Fetch `url` as JSON, returning a cached result when it's younger than `ttlMs`.
 * Concurrent callers for the same URL share a single in-flight request.
 */
export async function cachedGetJson<T>(url: string, ttlMs = 30_000): Promise<T> {
  const now = Date.now();
  const hit = cache.get(url);
  if (hit) {
    if (hit.inflight) return hit.inflight as Promise<T>;
    if (now - hit.ts < ttlMs) return hit.data as T;
  }
  const inflight = fetch(url)
    .then(r => r.json())
    .then(data => {
      cache.set(url, { ts: Date.now(), data });
      return data as T;
    })
    .catch(err => {
      // Drop the failed entry so the next call retries instead of caching a miss.
      cache.delete(url);
      throw err;
    });
  cache.set(url, { ts: now, data: hit?.data, inflight });
  return inflight;
}

/** Invalidate a cached URL (call after a mutation that changes its response). */
export function invalidateCache(url: string): void {
  cache.delete(url);
}
