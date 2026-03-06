import type { SessionData, Action, AgentData } from '@/lib/types';
import { DESK_POSITIONS, OVERFLOW_POSITIONS, MAX_RECENT_ACTIONS } from '@/lib/constants';

// Persist all state on globalThis to survive Next.js dev hot reloads
const g = globalThis as Record<string, unknown>;
if (!g.__sessions) g.__sessions = new Map<string, SessionData>();
if (!g.__deskAssignments) g.__deskAssignments = new Map<number, string>();
if (!g.__exitedAgentTypes) g.__exitedAgentTypes = new Set<string>();
const sessions = g.__sessions as Map<string, SessionData>;
const deskAssignments = g.__deskAssignments as Map<number, string>;
const exitedAgentTypes = g.__exitedAgentTypes as Set<string>;

export function markAgentTypeExited(parentSessionId: string, agentType: string): void {
  const key = `${parentSessionId}:${agentType}`;
  exitedAgentTypes.add(key);
  setTimeout(() => exitedAgentTypes.delete(key), 30_000);
}

export function isAgentTypeExited(parentSessionId: string, agentType: string): boolean {
  return exitedAgentTypes.has(`${parentSessionId}:${agentType}`);
}

export function getAllSessions(): SessionData[] {
  return Array.from(sessions.values());
}

export function getSession(id: string): SessionData | undefined {
  return sessions.get(id);
}

export function addSession(session: SessionData): void {
  // Don't duplicate — if already exists, skip
  if (sessions.has(session.id)) return;
  sessions.set(session.id, session);
  deskAssignments.set(session.deskIndex, session.id);
}

export function removeSession(id: string): void {
  const session = sessions.get(id);
  if (session) {
    deskAssignments.delete(session.deskIndex);
    sessions.delete(id);
  }
}

export function updateSession(id: string, changes: Partial<SessionData>): void {
  const session = sessions.get(id);
  if (session) {
    Object.assign(session, changes);
  }
}

export function addAction(sessionId: string, action: Action): void {
  const session = sessions.get(sessionId);
  if (session) {
    session.recentActions.unshift(action);
    if (session.recentActions.length > MAX_RECENT_ACTIONS) {
      session.recentActions = session.recentActions.slice(0, MAX_RECENT_ACTIONS);
    }
  }
}

export function addAgent(sessionId: string, agent: AgentData): void {
  const session = sessions.get(sessionId);
  if (session) {
    session.agents.push(agent);
  }
}

export function removeAgent(sessionId: string, agentId: string): void {
  const session = sessions.get(sessionId);
  if (session) {
    session.agents = session.agents.filter((a) => a.id !== agentId);
  }
}

export function getNextDeskIndex(): number {
  const totalDesks = DESK_POSITIONS.length;
  const totalOverflow = OVERFLOW_POSITIONS.length;
  const total = totalDesks + totalOverflow;

  for (let i = 0; i < total; i++) {
    if (!deskAssignments.has(i)) {
      return i;
    }
  }

  // All spots taken, return next overflow index anyway
  return total;
}
