import type { FileOp } from './types';

/**
 * Parse Copilot's `apply_patch` argument — a single string in the OpenAI
 * "*** Begin Patch" envelope — into normalized FileOps.
 *
 * Grammar (per-file sections):
 *   *** Begin Patch
 *   *** Add File: <path>
 *   +<line>                     (every line of a new file, + prefixed)
 *   *** Update File: <path>
 *   [*** Move to: <path>]       (rename target, optional)
 *   @@ [context]
 *    <context>                  (space prefix)
 *   -<removed>
 *   +<added>
 *   *** Delete File: <path>
 *   *** End Patch
 *
 * Add File   → create op (content = joined + lines).
 * Delete File→ delete op.
 * Update File→ one edit op per hunk: oldStr = context+removed lines,
 *              newStr = context+added lines. Context anchors the replacement so
 *              reverse-apply can find it. Best-effort (patches are ~1% of ops).
 */
export function parseApplyPatch(patch: string, ts?: number, toolCallId?: string): FileOp[] {
  if (typeof patch !== 'string' || !patch.includes('*** ')) return [];
  const lines = patch.split('\n');
  const ops: FileOp[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    const add = line.match(/^\*\*\* Add File: (.+)$/);
    if (add) {
      const path = add[1].trim();
      i++;
      const body: string[] = [];
      while (i < lines.length && !lines[i].startsWith('*** ')) {
        body.push(lines[i].startsWith('+') ? lines[i].slice(1) : lines[i]);
        i++;
      }
      ops.push({ path, kind: 'create', content: body.join('\n'), ts, toolCallId });
      continue;
    }

    const del = line.match(/^\*\*\* Delete File: (.+)$/);
    if (del) {
      ops.push({ path: del[1].trim(), kind: 'delete', ts, toolCallId });
      i++;
      continue;
    }

    const upd = line.match(/^\*\*\* Update File: (.+)$/);
    if (upd) {
      const path = upd[1].trim();
      i++;
      // Skip an optional "*** Move to:" line (rename); we keep the original path.
      if (i < lines.length && lines[i].startsWith('*** Move to:')) i++;
      // Collect hunks until the next file section / end.
      while (i < lines.length && !lines[i].startsWith('*** ')) {
        if (lines[i].startsWith('@@')) {
          i++;
          const oldLines: string[] = [];
          const newLines: string[] = [];
          while (
            i < lines.length &&
            !lines[i].startsWith('*** ') &&
            !lines[i].startsWith('@@')
          ) {
            const l = lines[i];
            if (l.startsWith('-')) oldLines.push(l.slice(1));
            else if (l.startsWith('+')) newLines.push(l.slice(1));
            else {
              // Context line (leading space, or bare) — belongs to both sides.
              const ctx = l.startsWith(' ') ? l.slice(1) : l;
              oldLines.push(ctx);
              newLines.push(ctx);
            }
            i++;
          }
          const oldStr = oldLines.join('\n');
          const newStr = newLines.join('\n');
          if (oldStr !== newStr) {
            ops.push({ path, kind: 'edit', oldStr, newStr, ts, toolCallId });
          }
        } else {
          i++;
        }
      }
      continue;
    }

    i++;
  }

  return ops;
}
