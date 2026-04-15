export type CliType = 'claude' | 'copilot';

export interface CliHealth {
  type: CliType;
  installed: boolean;
  version: string | null;
  binaryPath: string | null;
  error?: string;
}

export interface SpawnOptions {
  cwd: string;
  sessionId?: string;
  permissionMode?: string;
  model?: string;
  effort?: string;
  allowedTools?: string;
  systemPrompt?: string;
  // Copilot-specific
  copilotMode?: string;  // 'interactive' | 'plan' | 'autopilot'
}

export interface ResumeOptions {
  cwd: string;
  resumeId: string;
  fork?: boolean;
}

export interface CliProvider {
  readonly type: CliType;
  readonly configDir: string;
  readonly displayName: string;
  readonly iconSvg: string;
  readonly iconColor: string;

  findBinary(): string;
  checkHealth(): CliHealth;
  buildSpawnArgs(opts: SpawnOptions): string[];
  buildResumeArgs(opts: ResumeOptions): string[];
  detectPromptReady(text: string): boolean;
  parseContextUsage(text: string): number | null;
  getModelList(): Array<{ value: string; label: string }>;
}
