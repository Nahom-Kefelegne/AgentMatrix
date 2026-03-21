'use client';

interface ContextBarProps {
  usage: number | null;
  compact?: boolean;
}

export default function ContextBar({ usage, compact }: ContextBarProps) {
  if (usage === null) return null;
  const remaining = 100 - usage;
  const color = usage > 80 ? '#ef4444' : usage > 50 ? '#f59e0b' : '#34d399';

  return (
    <div style={{ width: '100%' }}>
      {!compact && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8 }} className="muted-text">Context</span>
          <span style={{ fontSize: 13, fontWeight: 600, color }}>{remaining}% remaining</span>
        </div>
      )}
      <div className="context-bar-track" style={{ height: compact ? 4 : 6 }}>
        <div className="context-bar-fill" style={{ width: `${usage}%`, background: color }} />
      </div>
      {compact && (
        <div className="context-bar-label">{remaining}% left</div>
      )}
    </div>
  );
}
