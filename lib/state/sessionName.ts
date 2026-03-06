import { readFileSync } from 'fs';

/**
 * Extract the session name from a Claude Code transcript file.
 * Priority:
 * 1. Custom name from /rename command in queue-operation entries
 * 2. Auto-generated slug (e.g. "synchronous-noodling-metcalfe")
 * 3. Last segment of cwd
 * 4. Short session ID
 */
export function resolveSessionName(
  transcriptPath?: string,
  cwd?: string,
  sessionId?: string,
): string {
  if (transcriptPath) {
    try {
      const content = readFileSync(transcriptPath, 'utf-8');

      // Look for /rename in queue-operation entries (most reliable)
      // Format: {"type":"queue-operation","operation":"enqueue",...,"content":"/rename someName"}
      const renameMatches = content.match(/"content"\s*:\s*"\/rename\s+([a-zA-Z0-9_-]+)"/g);
      if (renameMatches && renameMatches.length > 0) {
        const last = renameMatches[renameMatches.length - 1];
        const nameMatch = last.match(/\/rename\s+([a-zA-Z0-9_-]+)/);
        if (nameMatch) return nameMatch[1];
      }

      // Fall back to slug
      const slugMatch = content.match(/"slug"\s*:\s*"([^"]+)"/);
      if (slugMatch) {
        return slugMatch[1];
      }
    } catch {
      // File might not exist yet or be unreadable
    }
  }

  // Fall back to last segment of cwd
  if (cwd) {
    const segments = cwd.split('/').filter(Boolean);
    if (segments.length > 0) {
      return segments[segments.length - 1];
    }
  }

  return `Session-${(sessionId || 'unknown').slice(0, 6)}`;
}
