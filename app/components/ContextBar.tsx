'use client';

interface ContextBarProps {
  usage: number | null; // 0-100 percent used
  compact?: boolean;    // smaller version for cards
}

export default function ContextBar({ usage, compact }: ContextBarProps) {
  if (usage === null) return null;

  const remaining = 100 - usage;
  const color = usage > 80 ? '#ff6b6b' : usage > 50 ? '#f0c040' : '#51cf66';
  const height = compact ? 4 : 6;

  return (
    <div style={{ width: '100%' }}>
      {!compact && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: 6,
        }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: 0.8 }}>
            Context
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, color }}>
            {remaining}% remaining
          </span>
        </div>
      )}
      <div style={{
        width: '100%', height, borderRadius: height / 2,
        background: '#1a1a28', overflow: 'hidden',
      }}>
        <div style={{
          width: `${usage}%`, height: '100%', borderRadius: height / 2,
          background: color,
          transition: 'width 0.5s ease, background 0.5s ease',
        }} />
      </div>
      {compact && (
        <div style={{
          fontSize: 11, color: '#666', marginTop: 3, textAlign: 'right',
        }}>
          {remaining}% left
        </div>
      )}
    </div>
  );
}
