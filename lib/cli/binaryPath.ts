/**
 * Windows-safe resolution of a CLI binary from `where` / `which` output.
 *
 * npm global installs place TWO entries on PATH for the same command: an
 * extensionless POSIX shell script (`#!/bin/sh`, for Git Bash / MSYS) and a
 * Windows shim (`.cmd`). `where` lists the extensionless one FIRST, but Windows
 * `CreateProcess` cannot execute it — node-pty fails with
 * `Cannot create process, error code: 193` (ERROR_BAD_EXE_FORMAT).
 *
 * So on Windows we must pick the first candidate carrying an executable
 * extension rather than blindly taking line 0.
 */

/** Executable suffixes, most-preferred first. Mirrors a sane PATHEXT order. */
const WINDOWS_EXEC_EXTENSIONS = ['.exe', '.cmd', '.bat', '.com'];

/**
 * Choose a spawnable path from the lines emitted by `where` (Windows) or
 * `which` (POSIX).
 *
 * On Windows, prefers entries ending in an executable extension, in
 * `WINDOWS_EXEC_EXTENSIONS` order; falls back to the first line when none
 * qualifies (better to try and surface a real error than to return nothing).
 * On POSIX the first line is already correct.
 *
 * Returns undefined when there are no candidates.
 */
export function pickSpawnableBinary(lines: string[]): string | undefined {
  const candidates = lines.map(l => l.trim()).filter(Boolean);
  if (candidates.length === 0) return undefined;
  if (process.platform !== 'win32') return candidates[0];

  for (const ext of WINDOWS_EXEC_EXTENSIONS) {
    const hit = candidates.find(c => c.toLowerCase().endsWith(ext));
    if (hit) return hit;
  }
  return candidates[0];
}
