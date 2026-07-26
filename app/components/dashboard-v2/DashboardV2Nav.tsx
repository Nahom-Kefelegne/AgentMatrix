'use client';

import {
  ClipboardList,
  Moon,
  Plus,
  RotateCcw,
  Settings,
  Sun,
  Wrench,
} from 'lucide-react';
import { useThemeContext } from '../ThemeProvider';
import type { DashboardV2Navigation, DashboardV2ViewMode } from './types';

const VIEW_LABELS: { key: DashboardV2ViewMode; label: string }[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'office', label: 'Office' },
];

const numberFormat = new Intl.NumberFormat();

export default function DashboardV2Nav({
  connected,
  sessionCount,
  editorUnlocked,
  onViewChange,
  onNewSession,
  onResume,
  onTasks,
  onSettings,
  onSetup,
}: DashboardV2Navigation) {
  const { theme, toggleTheme } = useThemeContext();
  const views = editorUnlocked
    ? [...VIEW_LABELS, { key: 'editor' as const, label: 'Editor' }]
    : VIEW_LABELS;

  return (
    <nav className="mc-nav" aria-label="AgentMatrix">
      <div className="mc-nav-brand">
        <span className="mc-nav-mark" aria-hidden="true">AM</span>
        <span className={`mc-nav-connection ${connected ? 'mc-nav-connection--online' : ''}`} />
        <span className="mc-nav-title" translate="no">AgentMatrix</span>
        <span className="mc-nav-count">{numberFormat.format(sessionCount)}</span>
      </div>

      <div className="mc-nav-views" aria-label="View">
        {views.map(view => (
          <button
            key={view.key}
            type="button"
            className={`mc-nav-view ${view.key === 'dashboard' ? 'mc-nav-view--active' : ''}`}
            onClick={() => onViewChange(view.key)}
          >
            {view.label}
          </button>
        ))}
      </div>

      <div className="mc-nav-actions">
        <button type="button" className="mc-nav-action mc-nav-action--primary" onClick={onNewSession} aria-label="New session" title="New Session">
          <Plus size={14} aria-hidden="true" />
          <span>New</span>
        </button>
        <button type="button" className="mc-nav-action" onClick={onResume} aria-label="Resume session" title="Resume Session">
          <RotateCcw size={14} aria-hidden="true" />
          <span>Resume</span>
        </button>
        <button type="button" className="mc-nav-action" onClick={onTasks} aria-label="Open tasks" title="Tasks">
          <ClipboardList size={14} aria-hidden="true" />
          <span>Tasks</span>
        </button>
        <span className="mc-nav-separator" aria-hidden="true" />
        <button type="button" className="mc-nav-icon" onClick={toggleTheme} aria-label="Toggle theme" title="Toggle Theme">
          {theme === 'dark' ? <Sun size={15} aria-hidden="true" /> : <Moon size={15} aria-hidden="true" />}
        </button>
        <button type="button" className="mc-nav-icon" onClick={onSetup} aria-label="Configure hooks" title="Hooks Config">
          <Wrench size={15} aria-hidden="true" />
        </button>
        <button type="button" className="mc-nav-icon" onClick={onSettings} aria-label="Open settings" title="Settings">
          <Settings size={15} aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}
