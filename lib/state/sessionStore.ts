import type { SessionData, Action, AgentData } from '../types';
import { DESK_POSITIONS, OVERFLOW_POSITIONS, MAX_RECENT_ACTIONS } from '../constants';
import { clearCanvasRequests } from '../canvas/requestStore';
import { clearNavigationCapability } from '../navigation/rootRegistry';

// Persist all state on globalThis to survive Next.js dev hot reloads
const g = globalThis as Record<string, unknown>;
if (!g.__sessions) g.__sessions = new Map<string, SessionData>();
if (!g.__deskAssignments) g.__deskAssignments = new Map<number, string>();
if (!g.__exitedAgentTypes) g.__exitedAgentTypes = new Set<string>();
if (!g.__agentIdToName) g.__agentIdToName = new Map<string, string>();
if (!g.__appManagedIds) g.__appManagedIds = new Set<string>();
if (!(g.__restartingSessionIds instanceof Map)) g.__restartingSessionIds = new Map<string, number>();
const sessions = g.__sessions as Map<string, SessionData>;
const deskAssignments = g.__deskAssignments as Map<number, string>;
const exitedAgentTypes = g.__exitedAgentTypes as Set<string>;
const agentIdToName = g.__agentIdToName as Map<string, string>;
const appManagedIds = g.__appManagedIds as Set<string>;
const restartingSessionIds = g.__restartingSessionIds as Map<string, number>;

export function markSessionRestarting(sessionId: string): number {
  const generation = (restartingSessionIds.get(sessionId) ?? 0) + 1;
  restartingSessionIds.set(sessionId, generation);
  return generation;
}

export function isSessionRestarting(sessionId: string): boolean {
  return restartingSessionIds.has(sessionId);
}

export function finishSessionRestart(sessionId: string, generation: number): void {
  // Keep a short grace window for delayed provider SessionEnd hooks from the
  // old CLI process. A deliberate End still removes the session through the
  // terminal:end cleanup path after its transcript flush.
  setTimeout(() => {
    if (restartingSessionIds.get(sessionId) === generation) restartingSessionIds.delete(sessionId);
  }, 10_000);
}

export function markAsAppManaged(sessionId: string): void {
  appManagedIds.add(sessionId);
}

export function unmarkAppManaged(sessionId: string): void {
  appManagedIds.delete(sessionId);
}

export function isAppManaged(sessionId: string): boolean {
  return appManagedIds.has(sessionId);
}

export function registerAgentId(agentId: string, name: string): void {
  agentIdToName.set(agentId, name);
}

export function getAgentName(agentId: string): string | undefined {
  return agentIdToName.get(agentId);
}

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
  clearCanvasRequests(id);
  clearNavigationCapability(id);
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

export function removeAgentByName(sessionId: string, name: string): string | undefined {
  const session = sessions.get(sessionId);
  if (session) {
    const agent = session.agents.find((a) => a.name === name);
    if (agent) {
      session.agents = session.agents.filter((a) => a.name !== name);
      return agent.id;
    }
  }
  return undefined;
}

export function updateAgentStatus(sessionId: string, agentId: string, agentName: string, status: 'idle' | 'working' | 'meeting'): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  const agent = session.agents.find(a => a.id === agentId || a.name === agentName);
  if (agent) {
    agent.status = status;
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
