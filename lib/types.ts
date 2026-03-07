// ===== Core Data Types =====

export interface Point {
  x: number;
  y: number;
}

export type SessionStatus = 'idle' | 'working' | 'meeting';

export interface Action {
  toolName: string;
  summary: string;
  timestamp: number;
}

export interface AgentData {
  id: string;
  name: string;
  parentSessionId: string;
  teamName?: string;
  color: string;
  status: SessionStatus;
  position: Point;
  currentTool?: string;
  createdAt: number;
}

export interface SessionData {
  id: string;
  name: string;
  color: string;
  status: SessionStatus;
  deskIndex: number;
  deskPosition: Point;
  spawnPosition: Point;
  currentTool?: string;
  lastToolSummary?: string;
  lastActivity?: number;
  recentActions: Action[];
  agents: AgentData[];
  teamId?: string;
  cwd?: string;
  createdAt: number;
}

// ===== UI Data (exposed to React) =====

export interface CharacterData {
  id: string;
  name: string;
  color: string;
  status: SessionStatus;
  currentTool?: string;
  lastToolSummary?: string;
  lastActivity?: number;
  recentActions: Action[];
  teamId?: string;
  isAgent: boolean;
  parentName?: string;
}

// ===== Hook Payloads (from Claude Code) =====

export interface HookPayload {
  session_id: string;
  session_name?: string;
  cwd?: string;
  timestamp?: string;
}

export interface SessionStartPayload extends HookPayload {}

export interface SessionEndPayload extends HookPayload {}

export interface ToolUsePayload extends HookPayload {
  tool_name: string;
  tool_input?: Record<string, unknown>;
}

export interface ToolCompletePayload extends HookPayload {
  tool_name: string;
  tool_output?: string;
}

export interface AgentStartPayload extends HookPayload {
  agent_id: string;
  agent_name?: string;
  team_name?: string;
  parent_session_id?: string;
}

export interface AgentStopPayload extends HookPayload {
  agent_id: string;
}

export interface StopPayload extends HookPayload {}

// ===== Task Types =====

export interface TaskItem {
  id: string;
  subject: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'deleted';
  owner?: string;
  activeForm?: string;
  blocks: string[];
  blockedBy: string[];
}

export interface TaskList {
  id: string;
  name: string;
  path: string;
  tasks: TaskItem[];
}

// ===== Socket Events =====

export interface ServerToClientEvents {
  'state:snapshot': (sessions: SessionData[]) => void;
  'session:start': (session: SessionData) => void;
  'session:end': (data: { sessionId: string }) => void;
  'session:update': (data: { sessionId: string; changes: Partial<SessionData> }) => void;
  'tool:start': (data: { sessionId: string; toolName: string; toolInput?: string }) => void;
  'tool:complete': (data: { sessionId: string; toolName: string; summary: string }) => void;
  'agent:start': (data: { sessionId: string; agent: AgentData }) => void;
  'agent:stop': (data: { sessionId: string; agentId: string }) => void;
  'meeting:start': (data: { teamId: string; participantIds: string[] }) => void;
  'meeting:message': (data: { teamId: string; fromId: string; toId: string; summary: string }) => void;
  'prompt:output': (data: { sessionId: string; text: string }) => void;
  'prompt:ready': (data: { sessionId: string }) => void;
  'prompt:error': (data: { sessionId: string; error: string }) => void;
  'terminal:data': (data: { sessionId: string; data: string }) => void;
  'terminal:exit': (data: { sessionId: string; exitCode: number }) => void;
  'terminal:consent': (data: { sessionId: string }) => void;
}

export interface ClientToServerEvents {
  'prompt:send': (data: { sessionId: string; prompt: string }) => void;
  'terminal:input': (data: { sessionId: string; data: string }) => void;
  'terminal:spawn': (data: { sessionId: string }) => void;
  'terminal:resize': (data: { sessionId: string; cols: number; rows: number }) => void;
}

// ===== Socket Event Names =====

export const SOCKET_EVENTS = {
  STATE_SNAPSHOT: 'state:snapshot',
  SESSION_START: 'session:start',
  SESSION_END: 'session:end',
  SESSION_UPDATE: 'session:update',
  TOOL_START: 'tool:start',
  TOOL_COMPLETE: 'tool:complete',
  AGENT_START: 'agent:start',
  AGENT_STOP: 'agent:stop',
  MEETING_START: 'meeting:start',
  MEETING_MESSAGE: 'meeting:message',
  PROMPT_SEND: 'prompt:send',
  PROMPT_OUTPUT: 'prompt:output',
  PROMPT_READY: 'prompt:ready',
  PROMPT_ERROR: 'prompt:error',
  TERMINAL_DATA: 'terminal:data',
  TERMINAL_INPUT: 'terminal:input',
  TERMINAL_SPAWN: 'terminal:spawn',
  TERMINAL_RESIZE: 'terminal:resize',
  TERMINAL_EXIT: 'terminal:exit',
  TERMINAL_CONSENT: 'terminal:consent',
} as const;
