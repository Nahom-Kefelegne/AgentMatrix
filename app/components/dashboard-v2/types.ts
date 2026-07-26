import type { AttentionItem, DashboardModel } from '@/lib/dashboard/attentionQueue';
import type { FileChange } from '@/lib/cli/transcript/types';
import type { SessionData } from '@/lib/types';

export type DashboardV2ViewMode = 'dashboard' | 'office' | 'editor';

export interface DashboardV2Navigation {
  connected: boolean;
  sessionCount: number;
  editorUnlocked: boolean;
  onViewChange: (mode: DashboardV2ViewMode) => void;
  onNewSession: () => void;
  onResume: () => void;
  onTasks: () => void;
  onSettings: () => void;
  onSetup: () => void;
}

export interface ChangeSummary {
  files: FileChange[];
  totalAdditions: number;
  totalDeletions: number;
}

export interface ChangeSummaryState {
  data: ChangeSummary | null;
  loading: boolean;
  error: string | null;
}

export interface DashboardV2ViewProps {
  model: DashboardModel;
  selectedSession: SessionData | null;
  selectedAttention: AttentionItem | null;
  selectedSessionId: string | null;
  selectedContextUsage: number | null;
  consoleVisible: boolean;
  navigation: DashboardV2Navigation;
  changes: ChangeSummaryState;
  onSelectSession: (sessionId: string) => void;
  onOpenSession: (sessionId: string) => void;
  onReviewChanges: (sessionId: string) => void;
  onRequestSummary: (sessionId: string) => void;
  onFullscreenSession: (sessionId: string) => void;
}
