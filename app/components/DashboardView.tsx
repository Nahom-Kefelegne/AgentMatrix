'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { SessionData } from '@/lib/types';
import { useSocketContext } from './SocketProvider';
import ContextBar from './ContextBar';
import { useSessionContext } from '@/lib/hooks/useSessionContext';
import { cn } from '@/lib/utils';
import { StatusIndicator } from '@/components/ui/status-indicator';
import { Button } from '@/components/ui/button';

function ago(ts: number): string {
  const d = Math.floor((Date.now() - ts) / 1000);
  if (d < 5) return 'just now';
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  return d < 86400 ? `${Math.floor(d / 3600)}h ago` : `${Math.floor(d / 86400)}d ago`;
}

interface Props {
  sessions: Map<string, SessionData>;
  onSelectSession: (id: string) => void;
}

const FILTERS = [
  { key: 'all', label: 'All Sessions' },
  { key: 'working', label: 'Working' },
  { key: 'idle', label: 'Idle' },
  { key: 'meeting', label: 'Meeting' },
] as const;

export default function DashboardView({ sessions, onSelectSession }: Props) {
  const { socketRef, connected } = useSocketContext();
  const contextMap = useSessionContext(socketRef, connected);
  const all = Array.from(sessions.values());
  const [filter, setFilter] = useState('all');
  const [, tick] = useState(0);
  useEffect(() => { const i = setInterval(() => tick(t => t + 1), 5000); return () => clearInterval(i); }, []);

  const list = filter === 'all' ? all : all.filter(s => s.status === filter);
  const counts: Record<string, number> = {
    all: all.length,
    working: all.filter(s => s.status === 'working').length,
    idle: all.filter(s => s.status === 'idle').length,
    meeting: all.filter(s => s.status === 'meeting').length,
  };

  const visibleFilters = FILTERS.filter(f => f.key === 'all' || counts[f.key] > 0);

  return (
    <div className="mt-[var(--header-height)] h-[calc(100vh-var(--header-height))] bg-background overflow-y-auto">
      <div className="max-w-[1100px] mx-auto px-10 pt-8 pb-12">
        {/* Filter bar */}
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex gap-2 mb-7"
        >
          {visibleFilters.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                'px-5 py-2 rounded-full text-sm font-semibold cursor-pointer',
                'border transition-all duration-200',
                filter === f.key
                  ? 'bg-primary/10 border-primary/30 text-primary'
                  : 'bg-glass-bg border-glass-border text-muted-foreground hover:text-foreground hover:border-foreground/15',
              )}
            >
              {f.label}
              <span className={cn(
                'ml-2 text-xs font-bold px-2 py-0.5 rounded-full',
                filter === f.key
                  ? 'bg-primary/15 text-primary'
                  : 'bg-muted text-muted-foreground',
              )}>
                {counts[f.key]}
              </span>
            </button>
          ))}
        </motion.div>

        {/* Cards */}
        {list.length === 0 ? (
          <EmptyState hasAny={all.length > 0} />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(460px,1fr))] gap-5">
            <AnimatePresence mode="popLayout">
              {list.map((s, i) => (
                <SessionCard
                  key={s.id}
                  s={s}
                  i={i}
                  contextUsage={contextMap[s.id] ?? null}
                  onClick={() => onSelectSession(s.id)}
                  socketRef={socketRef}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({ hasAny }: { hasAny: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col items-center justify-center py-28 gap-4"
    >
      <div className="size-16 rounded-full bg-muted/50 flex items-center justify-center">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted-foreground/40">
          <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
        </svg>
      </div>
      <div className="text-lg text-muted-foreground">
        {hasAny ? 'No sessions match filter' : 'No sessions yet'}
      </div>
      <div className="text-sm text-muted-foreground/60">
        Click <span className="text-primary font-semibold">+ New</span> to launch a session
      </div>
    </motion.div>
  );
}

function SessionCard({ s, i, contextUsage, onClick, socketRef }: {
  s: SessionData; i: number; contextUsage: number | null;
  onClick: () => void; socketRef: React.RefObject<any>;
}) {
  const working = s.status === 'working';
  const actions = s.recentActions.slice(0, 4);
  const [summaryRequested, setSummaryRequested] = useState(false);
  const hasSummary = s.summaryBullets && s.summaryBullets.length > 0;
  const summaryLoading = summaryRequested && !hasSummary;

  const handleRefreshSummary = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const socket = socketRef.current;
    if (!socket) return;
    setSummaryRequested(true);
    socket.emit('session:summary', { sessionId: s.id });
  }, [socketRef, s.id]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.3, delay: i * 0.04, type: 'spring', stiffness: 260, damping: 24 }}
      whileHover={{ y: -4, transition: { duration: 0.15 } }}
      onClick={onClick}
      className={cn(
        'cursor-pointer rounded-2xl overflow-hidden relative group',
        'bg-card border border-border/60',
        'hover:border-border hover:shadow-lg',
        'transition-[border-color,box-shadow] duration-200',
      )}
    >
      {/* Accent bar */}
      <div className={cn(
        'h-[3px]',
        working ? 'bg-status-working' : s.status === 'meeting' ? 'bg-status-meeting' : 'bg-status-idle',
        !working && 'opacity-30',
      )} />
      {working && (
        <div
          className="absolute top-0 inset-x-0 h-[3px]"
          style={{
            background: 'linear-gradient(90deg, transparent, var(--foreground, white) 50%, transparent)',
            opacity: 0.2,
            backgroundSize: '200% 100%',
            animation: 'shimmer 2s ease-in-out infinite',
          }}
        />
      )}

      <div className="p-5">
        {/* Name + Status */}
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="flex-1 min-w-0">
            <div className="text-lg font-bold text-foreground truncate">{s.name}</div>
            {s.cwd && (
              <div className="text-xs text-muted-foreground mt-1 font-mono truncate">{s.cwd}</div>
            )}
          </div>
          <StatusIndicator status={s.status as any} size="sm" />
        </div>

        {/* Context bar */}
        {contextUsage !== null && (
          <div className="mb-3.5">
            <ContextBar usage={contextUsage} compact />
          </div>
        )}

        {/* Stats */}
        <div className="flex gap-2.5 mb-3.5">
          <StatChip label="Session ID" value={s.id.slice(0, 8) + '...'} />
          {s.lastActivity && <StatChip label="Last Active" value={ago(s.lastActivity)} />}
          {s.agents && s.agents.length > 0 && (
            <StatChip label="Agents" value={`${s.agents.length} active`} accent />
          )}
        </div>

        {/* Current work indicator */}
        {working && s.lastToolSummary && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="px-3.5 py-2.5 rounded-xl mb-3.5 bg-primary/5 border border-primary/10"
          >
            <div className="text-[11px] font-bold text-primary/60 uppercase tracking-wider mb-1">
              Currently Working On
            </div>
            <div className="text-sm text-primary/80 font-mono truncate">
              {s.lastToolSummary}
            </div>
          </motion.div>
        )}

        {/* Summary or activity */}
        <div className="border-t border-border/50 pt-3">
          {hasSummary ? (
            <>
              <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">
                Work Summary
              </div>
              {s.summaryBullets!.map((bullet, j) => (
                <div key={j} className="flex items-center gap-2 py-0.5 text-sm">
                  <span className="text-primary text-[8px]">●</span>
                  <span className="text-foreground/70">{bullet}</span>
                </div>
              ))}
            </>
          ) : (
            <>
              {actions.length > 0 && (
                <>
                  <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">
                    Recent Activity
                  </div>
                  {actions.slice(0, 2).map((a, j) => (
                    <div key={j} className="flex items-center gap-2 py-0.5 text-sm" style={{ opacity: 1 - j * 0.2 }}>
                      <span className="text-muted-foreground/40 text-[10px]">▸</span>
                      <span className="flex-1 text-foreground/60 truncate">
                        {a.summary || a.toolName}
                      </span>
                    </div>
                  ))}
                </>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefreshSummary}
                disabled={summaryLoading}
                className="w-full mt-2"
              >
                {summaryLoading ? 'Generating...' : 'Generate Summary'}
              </Button>
            </>
          )}
        </div>

        {s.lastActivity && !working && (
          <div className="text-xs text-muted-foreground text-right mt-2.5">
            Last active {ago(s.lastActivity)}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function StatChip({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={cn(
      'px-3 py-1.5 rounded-lg flex-1',
      accent ? 'bg-primary/5 border border-primary/10' : 'bg-muted/50 border border-border/30',
    )}>
      <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className={cn(
        'text-sm font-semibold mt-0.5',
        accent ? 'text-primary/80' : 'text-foreground/70',
      )}>
        {value}
      </div>
    </div>
  );
}
