import { readFileSync, existsSync } from 'fs';
import type { FileOp } from './types';
import { parseApplyPatch } from './applyPatch';

/**
 * Parse a Copilot session's `events.jsonl` into an ordered list of successful
 * file operations.
 *
 * Copilot records each tool call as a `tool.execution_start`
 *   { toolCallId, toolName, arguments } paired with a later
 * `tool.execution_complete` { toolCallId, success }. We keep only file-mutating
 * tools whose completion succeeded (or, defensively, has no failure recorded),
 * so a tool that errored out doesn't show up as a phantom change.
 *
 * File-tool argument shapes (verified against real transcripts):
 *   create      → { path, file_text }
 *   edit        → { path, old_str, new_str }
 *   apply_patch → "*** Begin Patch …"  (parsed by parseApplyPatch)
 */
export function parseCopilotTranscript(transcriptPath: string): FileOp[] {
  if (!existsSync(transcriptPath)) return [];

  let raw: string;
  try {
    raw = readFileSync(transcriptPath, 'utf-8');
  } catch {
    return [];
  }

  const lines = raw.split('\n');

  // Pass 1: record completion outcomes by toolCallId.
  const failed = new Set<string>();
  for (const line of lines) {
    if (!line || !line.includes('tool.execution_complete')) continue;
    try {
      const evt = JSON.parse(line);
      if (evt?.type !== 'tool.execution_complete') continue;
      const id = evt.data?.toolCallId;
      if (id && evt.data?.success === false) failed.add(id);
    } catch {
      /* skip malformed line */
    }
  }

  // Pass 2: emit ops for successful file tools, in transcript order.
  const ops: FileOp[] = [];
  let seq = 0;
  for (const line of lines) {
    if (!line || !line.includes('tool.execution_start')) continue;
    let evt: any;
    try {
      evt = JSON.parse(line);
    } catch {
      continue;
    }
    if (evt?.type !== 'tool.execution_start') continue;

    const data = evt.data || {};
    const id: string | undefined = data.toolCallId;
    if (id && failed.has(id)) continue; // drop failed edits

    const ts = typeof evt.timestamp === 'number' ? evt.timestamp : ++seq;
    const tool = data.toolName;
    const args = data.arguments;

    if (tool === 'create' && args?.path) {
      ops.push({ path: args.path, kind: 'create', content: String(args.file_text ?? ''), ts, toolCallId: id });
    } else if (tool === 'edit' && args?.path) {
      ops.push({
        path: args.path,
        kind: 'edit',
        oldStr: String(args.old_str ?? ''),
        newStr: String(args.new_str ?? ''),
        ts,
        toolCallId: id,
      });
    } else if (tool === 'apply_patch' && typeof args === 'string') {
      ops.push(...parseApplyPatch(args, ts, id));
    }
  }

  return ops;
}
