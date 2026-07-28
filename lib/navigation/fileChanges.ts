import type { SessionFileChange } from '../types';
import { parseApplyPatch } from '../cli/transcript/applyPatch';

type ToolInput = Record<string, unknown> | string | undefined;

function objectInput(input: ToolInput): Record<string, unknown> | undefined {
  if (input && typeof input === 'object' && !Array.isArray(input)) return input;
  if (typeof input !== 'string' || !input.trim().startsWith('{')) return undefined;
  try {
    const parsed: unknown = JSON.parse(input);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function stringField(input: Record<string, unknown> | undefined, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = input?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

export function extractSessionFileChanges(
  toolName: string,
  input: ToolInput,
): SessionFileChange[] {
  const normalized = toolName.toLocaleLowerCase();
  const object = objectInput(input);
  const patch = typeof input === 'string'
    ? input
    : stringField(object, 'patch', 'input', 'text');

  // PascalCase Copilot hooks map apply_patch to the Claude-compatible `Edit`
  // name, so detect the patch envelope before branching on toolName.
  if (patch?.includes('*** Begin Patch')) {
    const moves = new Map<string, string>();
    const patchLines = patch.split('\n');
    for (let index = 0; index < patchLines.length; index++) {
      const update = patchLines[index].match(/^\*\*\* Update File: (.+)$/);
      const move = patchLines[index + 1]?.match(/^\*\*\* Move to: (.+)$/);
      if (update && move) moves.set(update[1].trim(), move[1].trim());
    }
    const changes: SessionFileChange[] = [];
    for (const [source, destination] of moves) {
      changes.push(
        { path: source, op: 'delete', detectedBy: 'hook', toolName },
        { path: destination, op: 'update', detectedBy: 'hook', toolName },
      );
    }
    for (const operation of parseApplyPatch(patch)) {
      if (moves.has(operation.path)) continue;
      const base = {
        detectedBy: 'hook' as const,
        toolName,
      };
      changes.push({
        ...base,
        path: operation.path,
        op: operation.kind === 'create'
          ? 'create' as const
          : operation.kind === 'delete'
            ? 'delete' as const
            : 'update' as const,
      });
    }
    return changes;
  }

  const path = stringField(object, 'file_path', 'path');
  if (!path) return [];
  if (normalized === 'create') {
    return [{ path, op: 'create', detectedBy: 'hook', toolName }];
  }
  if (['edit', 'multiedit'].includes(normalized)) {
    return [{ path, op: 'update', detectedBy: 'hook', toolName }];
  }
  if (normalized === 'write') {
    return [{ path, op: 'unknown', detectedBy: 'hook', toolName }];
  }
  return [];
}
