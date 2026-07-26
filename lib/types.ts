import type { NavigationRequest, NavigationResult, ReviewFeedback } from './navigation/types';

// ===== Review Comments =====

export interface ReviewComment {
  id: string;
  filePath: string;
  lineNumber: number;
  text: string;
  createdAt: number;
  resolved: boolean;
}

// ===== CLI Types =====

export type CliType = 'claude' | 'copilot';

// ===== Core Data Types =====

export interface Point {
  x: number;
  y: number;
}

export type SessionStatus = 'idle' | 'working' | 'meeting' | 'attention' | 'done';

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
  contextUsage?: number;
  summaryBullets?: string[];
  filesModified?: string[];
  statusReason?: string;
  cliType?: CliType;  // Which CLI this session uses (defaults to 'claude' for backward compat)
  createdAt: number;
  reviewComments?: ReviewComment[];
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
  /** A file-mutating tool completed — the changes viewer should re-fetch. */
  'session:files-changed': (data: { sessionId: string }) => void;
  /**
   * An out-of-band (ACP / injector) query the app ran against a session —
   * summary generation, handoff, deep search. Echoed to the console so these
   * otherwise-invisible interactions are transparent. Emitted twice per query:
   * once `running` (with the prompt), once `done`/`failed` (with the response).
   */
  'session:acp-activity': (data: {
    sessionId: string;
    id: string;
    label: string;
    prompt?: string;
    response?: string;
    status: 'running' | 'done' | 'failed';
    ts: number;
  }) => void;
  'tool:start': (data: { sessionId: string; toolName: string; toolInput?: string }) => void;
  'tool:complete': (data: { sessionId: string; toolName: string; summary: string }) => void;
  'agent:start': (data: { sessionId: string; agent: AgentData }) => void;
  'agent:stop': (data: { sessionId: string; agentId: string; agentName?: string }) => void;
  'meeting:start': (data: { teamId: string; participantIds: string[] }) => void;
  'meeting:message': (data: { teamId: string; fromId: string; toId: string; summary: string }) => void;
  'prompt:output': (data: { sessionId: string; text: string }) => void;
  'prompt:ready': (data: { sessionId: string }) => void;
  'prompt:error': (data: { sessionId: string; error: string }) => void;
  'terminal:data': (data: { sessionId: string; data: string }) => void;
  'terminal:exit': (data: { sessionId: string; exitCode: number }) => void;
  'terminal:consent': (data: { sessionId: string }) => void;
  'session:state': (data: { sessionId: string; state: string; actionType?: string; actionLabel?: string; activity?: string }) => void;
  // Editor shell terminals
  'editor:terminal:data': (data: { id: string; data: string }) => void;
  'editor:terminal:exit': (data: { id: string; exitCode: number }) => void;
  'editor:terminal:ready': (data: { id: string }) => void;
  // Context Canvas navigation lifecycle.
  'navigation:requested': (request: NavigationRequest) => void;
  'navigation:acknowledged': (result: NavigationResult) => void;
  'navigation:applied': (result: NavigationResult) => void;
  'navigation:failed': (result: NavigationResult) => void;
  'review:feedback': (feedback: ReviewFeedback) => void;
}

export interface ClientToServerEvents {
  'prompt:send': (data: { sessionId: string; prompt: string }) => void;
  'terminal:input': (data: { sessionId: string; data: string }) => void;
  'terminal:spawn': (data: { sessionId: string }) => void;
  'terminal:resize': (data: { sessionId: string; cols: number; rows: number }) => void;
  // Editor shell terminals
  'editor:terminal:spawn': (data: { id: string; cwd: string }) => void;
  'editor:terminal:input': (data: { id: string; data: string }) => void;
  'editor:terminal:resize': (data: { id: string; cols: number; rows: number }) => void;
  'editor:terminal:kill': (data: { id: string }) => void;
  'editor:terminal:attach': (data: { id: string }) => void;
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
  NAVIGATION_REQUESTED: 'navigation:requested',
  NAVIGATION_ACKNOWLEDGED: 'navigation:acknowledged',
  NAVIGATION_APPLIED: 'navigation:applied',
  NAVIGATION_FAILED: 'navigation:failed',
  REVIEW_FEEDBACK: 'review:feedback',
} as const;
