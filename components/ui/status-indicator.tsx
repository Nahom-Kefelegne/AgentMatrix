'use client';

import { cn } from '@/lib/utils';

type Status = 'working' | 'idle' | 'meeting';

const statusConfig: Record<Status, { label: string; colorClass: string }> = {
  working: { label: 'Working', colorClass: 'bg-status-working' },
  idle: { label: 'Idle', colorClass: 'bg-status-idle' },
  meeting: { label: 'In Meeting', colorClass: 'bg-status-meeting' },
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
      'bg-glass-bg backdrop-blur-sm border border-glass-border',
      padSize,
      className,
    )}>
      <span className="relative flex">
        <span className={cn(
          dotSize, 'rounded-full', config.colorClass,
          isActive && 'animate-[status-pulse_1.5s_ease-in-out_infinite]',
        )} />
        {isActive && (
          <span className={cn(
            'absolute inset-0 rounded-full', config.colorClass, 'opacity-40 animate-ping',
          )} />
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

interface ConnectionDotProps {
  connected: boolean;
  className?: string;
}

export function ConnectionDot({ connected, className }: ConnectionDotProps) {
  return (
    <span className={cn(
      'inline-block size-2.5 rounded-full border-2 border-background transition-colors duration-300',
      connected ? 'bg-status-working' : 'bg-destructive',
      className,
    )} />
  );
}
