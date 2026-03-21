'use client';

import { cn } from '@/lib/utils';

type Status = 'working' | 'idle' | 'meeting';

const statusConfig: Record<Status, { label: string; dotClass: string }> = {
  working: { label: 'Working', dotClass: 'bg-emerald-400' },
  idle: { label: 'Idle', dotClass: 'bg-zinc-500 dark:bg-zinc-400' },
  meeting: { label: 'In Meeting', dotClass: 'bg-violet-400' },
};

interface StatusIndicatorProps {
  status: Status;
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function StatusIndicator({ status, showLabel = true, size = 'md', className }: StatusIndicatorProps) {
  const config = statusConfig[status] || statusConfig.idle;
  const isActive = status === 'working';

  const dotSize = { sm: 'size-1.5', md: 'size-2', lg: 'size-2.5' }[size];
  const textSize = { sm: 'text-xs', md: 'text-sm', lg: 'text-base' }[size];
  const padSize = { sm: 'px-2 py-0.5', md: 'px-3 py-1', lg: 'px-4 py-1.5' }[size];

  return (
    <div className={cn(
      'inline-flex items-center gap-2 rounded-full',
      'bg-secondary/60 dark:bg-secondary/50 border border-border',
      padSize,
      className,
    )}>
      <span className="relative flex">
        <span className={cn(dotSize, 'rounded-full', config.dotClass)} />
        {isActive && (
          <span className={cn('absolute inset-0 rounded-full', config.dotClass, 'opacity-40 animate-ping')} />
        )}
      </span>
      {showLabel && (
        <span className={cn(textSize, 'font-semibold text-foreground/80')}>
          {config.label}
        </span>
      )}
    </div>
  );
}

export function ConnectionDot({ connected, className }: { connected: boolean; className?: string }) {
  return (
    <span className={cn(
      'inline-block size-2.5 rounded-full border-2 border-background transition-colors duration-300',
      connected ? 'bg-emerald-400' : 'bg-destructive',
      className,
    )} />
  );
}
