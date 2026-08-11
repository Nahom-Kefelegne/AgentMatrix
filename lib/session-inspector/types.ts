export type SessionInspectorScope = 'managed' | 'runtime' | 'project' | 'user';

export interface SessionInspectorMcpSource {
  label: string;
  scope: SessionInspectorScope;
}

export interface SessionInspectorMcp {
  id: string;
  name: string;
  effectiveSource: string;
  scope: SessionInspectorScope;
  sources: SessionInspectorMcpSource[];
  transport: 'stdio' | 'http' | 'sse' | 'unknown';
  command?: string;
  envKeys: string[];
  managed: boolean;
}

export interface SessionInspectorTask {
  id: string;
  subject: string;
  description: string;
  status: 'pending' | 'assigned' | 'completed';
  source: 'app' | 'ado';
  type?: string;
  priority?: string;
  adoId?: number;
  assignedAt?: number;
}

export interface SessionInspectorProfile {
  permissionMode?: string;
  model?: string;
  effort?: string;
  allowedTools?: string;
  copilotMode?: string;
}

export interface SessionInspectorData {
  profile: SessionInspectorProfile;
  mcps: SessionInspectorMcp[];
  tasks: SessionInspectorTask[];
}
