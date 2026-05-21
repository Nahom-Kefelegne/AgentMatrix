import { NextResponse } from 'next/server';
import { getCachedName } from '@/lib/state/nameCache';
import { allProviders } from '@/lib/cli';
import type { CliType } from '@/lib/types';
import type { CliProvider, DiscoveredSession } from '@/lib/cli/CliProvider';

interface SessionInfo {
  id: string;
  name: string;
  cwd: string;
  lastModified: number;
  active: boolean;
  cliType: CliType;
  /** Legacy fields retained for UI backwards compatibility — will be
   *  removed in Phase 1 once ResumeModal stops referencing them. */
  slug: string;
  projectDir: string;
}

/**
 * List on-disk sessions for either a single CWD (default) or all
 * sessions globally across both CLIs.
 *
 * GET /api/sessions/list?cwd=...                 → sessions in that dir
 * GET /api/sessions/list?global=true             → all sessions everywhere
 * GET /api/sessions/list?cliType=copilot...      → restrict to one CLI
 *
 * COST: discoverSessions() is the expensive part — see provider docs.
 * `global=true` calls it once per provider; cwd-scoped filters in-memory
 * after the discovery, so still one discovery per provider.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const cwd = searchParams.get('cwd') || '';
    const global = searchParams.get('global') === 'true';
    const cliFilter = searchParams.get('cliType') as CliType | null;

    const providers: CliProvider[] = cliFilter
      ? allProviders().filter(p => p.type === cliFilter)
      : allProviders();

    const activeByCli = new Map<CliType, Set<string>>();
    for (const p of providers) {
      try {
        const active = new Set(p.detectActiveSessionIds().map(a => a.sessionId));
        activeByCli.set(p.type, active);
      } catch {
        activeByCli.set(p.type, new Set());
      }
    }

    const all: SessionInfo[] = [];
    for (const provider of providers) {
      let discovered: DiscoveredSession[] = [];
      try {
        discovered = provider.discoverSessions();
      } catch {
        continue;
      }
      const active = activeByCli.get(provider.type) ?? new Set<string>();
      for (const s of discovered) {
        if (!global && cwd && s.cwd !== cwd) continue;
        all.push({
          id: s.id,
          name: getCachedName(s.id) || s.name || `Session-${s.id.slice(0, 8)}`,
          cwd: s.cwd || '',
          lastModified: s.lastModified ?? 0,
          active: active.has(s.id),
          cliType: provider.type,
          slug: '',
          projectDir: '',
        });
      }
    }

    all.sort((a, b) => b.lastModified - a.lastModified);
    return NextResponse.json({ sessions: all });
  } catch (error) {
    console.error('[sessions/list]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
