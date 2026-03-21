'use client';

import { cn } from '@/lib/utils';

interface ContextBarProps {
  usage: number | null;
  compact?: boolean;
}

export default function ContextBar({ usage, compact }: ContextBarProps) {
  if (usage === null) return null;

  const remaining = 100 - usage;
  const colorClass = usage > 80
    ? 'bg-destructive'
    : usage > 50
    ? 'bg-amber-500 dark:bg-amber-400'
    : 'bg-status-working';

  return (
    <div className="w-full">
      {!compact && (
        <div className="flex justify-between items-center mb-1.5">
          <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Context</span>
          <span className={cn(
            'text-sm font-semibold',
            usage > 80 ? 'text-destructive' : usage > 50 ? 'text-amber-600 dark:text-amber-400' : 'text-status-working',
          )}>
            {remaining}% remaining
          </span>
        </div>
      )}
      <div className={cn(
        'w-full rounded-full overflow-hidden',
        compact ? 'h-1' : 'h-1.5',
        'bg-muted',
      )}>
        <div
          className={cn('h-full rounded-full transition-all duration-500 ease-out', colorClass)}
          style={{ width: `${usage}%` }}
        />
      </div>
      {compact && (
        <div className="text-[11px] text-muted-foreground mt-1 text-right">
          {remaining}% left
        </div>
      )}
    </div>
  );
}
