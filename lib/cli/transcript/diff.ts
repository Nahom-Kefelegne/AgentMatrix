/**
 * Minimal line-level diff — just enough to count additions/deletions for the
 * changes list. Uses a classic LCS over lines. Capped to avoid O(n·m) blowups
 * on very large files; past the cap we fall back to a coarse magnitude estimate
 * (the summary counts are informational — the real diff is rendered by Monaco).
 */

const LCS_CELL_CAP = 4_000_000; // ~4M DP cells (e.g. 2000×2000 lines)

export interface LineDiffCounts {
  additions: number;
  deletions: number;
}

export function countLineDiff(original: string, current: string): LineDiffCounts {
  if (original === current) return { additions: 0, deletions: 0 };
  if (!original) return { additions: splitLines(current).length, deletions: 0 };
  if (!current) return { additions: 0, deletions: splitLines(original).length };

  const a = splitLines(original);
  const b = splitLines(current);

  // Trim common prefix/suffix — cheap and dramatically shrinks the LCS problem.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  if (midA.length === 0) return { additions: midB.length, deletions: 0 };
  if (midB.length === 0) return { additions: 0, deletions: midA.length };

  // Guard against pathological sizes.
  if (midA.length * midB.length > LCS_CELL_CAP) {
    return {
      additions: Math.max(0, midB.length),
      deletions: Math.max(0, midA.length),
    };
  }

  const lcs = lcsLength(midA, midB);
  return {
    additions: midB.length - lcs,
    deletions: midA.length - lcs,
  };
}

function splitLines(s: string): string[] {
  // Drop a single trailing newline so a file ending in "\n" doesn't report a
  // phantom empty last line.
  const trimmed = s.endsWith('\n') ? s.slice(0, -1) : s;
  return trimmed.split('\n');
}

function lcsLength(a: string[], b: string[]): number {
  // Rolling two-row DP — O(n·m) time, O(m) space.
  let prev = new Array<number>(b.length + 1).fill(0);
  let curr = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1] + 1
        : Math.max(prev[j], curr[j - 1]);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}
