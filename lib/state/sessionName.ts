import { statSync, openSync, readSync, closeSync } from 'fs';

/**
 * Read a chunk of a file.
 */
function readChunk(filePath: string, offset: number, maxBytes: number): string {
  try {
    const stat = statSync(filePath);
    const start = Math.max(0, Math.min(offset, stat.size));
    const length = Math.min(maxBytes, stat.size - start);
    if (length <= 0) return '';
    const buffer = Buffer.alloc(length);
    const fd = openSync(filePath, 'r');
    readSync(fd, buffer, 0, length, start);
    closeSync(fd);
    return buffer.toString('utf-8');
  } catch {
    return '';
  }
}

/**
 * Extract the session name from a Claude Code transcript file.
 * Priority:
 * 1. Custom name from /rename command (checks last 50KB for recent renames)
 * 2. Auto-generated slug from transcript entries
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
      const stat = statSync(transcriptPath);

      // Read last 500KB for recent /rename commands
      const tailStart = Math.max(0, stat.size - 500_000);
      const tail = readChunk(transcriptPath, tailStart, 500_000);

      // Look for rename — handles "renamed to: name" and "renamed to: \nname" (escaped newline in JSONL)
      const renamedTo = tail.match(/<local-command-stdout>Session and agent renamed to:(?:\\n| )*([a-zA-Z0-9_-]+)/g);
      if (renamedTo && renamedTo.length > 0) {
        const last = renamedTo[renamedTo.length - 1];
        const nameMatch = last.match(/renamed to:(?:\\n| )*([a-zA-Z0-9_-]+)/);
        if (nameMatch) return nameMatch[1];
      }

      // Check first 3KB for slug (appears in early entries)
      const head = readChunk(transcriptPath, 0, 3000);
      const slugMatch = head.match(/"slug"\s*:\s*"([^"]+)"/);
      if (slugMatch) {
        return slugMatch[1];
      }

      // NOTE: Do NOT check tail for slug — conversation content often contains
      // repeated slug strings from compacted summaries, causing false matches.
    } catch {
      // File might not exist yet
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

/**
 * Check if a session has been /renamed. Returns the new name or undefined.
 * Used by the scanner's periodic re-check to only upgrade names on rename,
 * not overwrite them with slug/cwd fallbacks.
 */
export function checkForRename(transcriptPath: string): string | undefined {
  try {
    const stat = statSync(transcriptPath);
    const tailStart = Math.max(0, stat.size - 500_000);
    const tail = readChunk(transcriptPath, tailStart, 500_000);

    const renamedTo = tail.match(/<local-command-stdout>Session and agent renamed to:(?:\\n| )*([a-zA-Z0-9_-]+)/g);
    if (renamedTo && renamedTo.length > 0) {
      const last = renamedTo[renamedTo.length - 1];
      const nameMatch = last.match(/renamed to:(?:\\n| )*([a-zA-Z0-9_-]+)/);
      if (nameMatch) return nameMatch[1];
    }
  } catch {
    // ignore
  }
  return undefined;
}
