import { readFileSync, existsSync } from 'fs';
import type { FileOp } from './types';

/**
 * Parse a Claude Code session transcript (`<uuid>.jsonl`) into an ordered list
 * of successful file operations.
 *
 * Claude records tool calls as `tool_use` blocks inside `type:"assistant"`
 * messages, and their outcomes as `tool_result` blocks inside the following
 * `type:"user"` message (matched by `tool_use_id`, `is_error` marks failure).
 *
 * File-tool input shapes (verified against real transcripts):
 *   Write     → { file_path, content }
 *   Edit      → { file_path, old_string, new_string, replace_all? }
 *   MultiEdit → { file_path, edits: [{ old_string, new_string, replace_all? }] }
 */
export function parseClaudeTranscript(transcriptPath: string): FileOp[] {
  if (!existsSync(transcriptPath)) return [];

  let raw: string;
  try {
    raw = readFileSync(transcriptPath, 'utf-8');
  } catch {
    return [];
  }

  const lines = raw.split('\n');

  // Pass 1: collect failed tool_use ids from tool_result blocks.
  const failed = new Set<string>();
  for (const line of lines) {
    if (!line || !line.includes('tool_result')) continue;
    try {
      const rec = JSON.parse(line);
      const content = rec?.message?.content;
      if (!Array.isArray(content)) continue;
      for (const b of content) {
        if (b?.type === 'tool_result' && b.is_error === true && b.tool_use_id) {
          failed.add(b.tool_use_id);
        }
      }
    } catch {
      /* skip */
    }
  }

  // Pass 2: emit ops for successful file tool_use blocks, in order.
  const ops: FileOp[] = [];
  let seq = 0;
  for (const line of lines) {
    if (!line || !line.includes('tool_use')) continue;
    let rec: any;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    const content = rec?.message?.content;
    if (!Array.isArray(content)) continue;

    for (const b of content) {
      if (b?.type !== 'tool_use') continue;
      const id: string | undefined = b.id;
      if (id && failed.has(id)) continue;
      const input = b.input || {};
      const path = input.file_path;
      if (!path) continue;
      const ts = ++seq;

      if (b.name === 'Write') {
        ops.push({ path, kind: 'create', content: String(input.content ?? ''), ts, toolCallId: id });
      } else if (b.name === 'Edit') {
        ops.push({
          path,
          kind: 'edit',
          oldStr: String(input.old_string ?? ''),
          newStr: String(input.new_string ?? ''),
          replaceAll: input.replace_all === true,
          ts,
          toolCallId: id,
        });
      } else if (b.name === 'MultiEdit' && Array.isArray(input.edits)) {
        for (const e of input.edits) {
          ops.push({
            path,
            kind: 'edit',
            oldStr: String(e.old_string ?? ''),
            newStr: String(e.new_string ?? ''),
            replaceAll: e.replace_all === true,
            ts,
            toolCallId: id,
          });
        }
      }
    }
  }

  return ops;
}
