'use client';

interface HeaderBarProps {
  connected: boolean;
  sessionCount: number;
  onSetupClick: () => void;
  onTasksClick: () => void;
  onResumeClick: () => void;
  onSessionsClick: () => void;
}

function HeaderButton({ onClick, label, title, badge }: {
  onClick: () => void; label: string; title: string; badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        padding: '8px 16px',
        borderRadius: 6,
        border: '1px solid #3a3a4e',
        background: '#1e1e30',
        color: '#c8c8d8',
        fontSize: 16,
        fontWeight: 600,
        fontFamily: 'inherit',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        cursor: 'pointer',
        position: 'relative',
      }}
    >
      {label}
      {badge !== undefined && badge > 0 && (
        <span style={{
          background: '#4a9eff', color: '#fff', fontSize: 11, fontWeight: 700,
          borderRadius: 10, padding: '1px 6px', minWidth: 18, textAlign: 'center',
        }}>
          {badge}
        </span>
      )}
    </button>
  );
}

export default function HeaderBar({
  connected, sessionCount, onSetupClick, onTasksClick, onResumeClick, onSessionsClick,
}: HeaderBarProps) {
  return (
    <header
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: 'var(--header-height)',
        background: 'rgba(10, 10, 20, 0.9)',
        backdropFilter: 'blur(8px)',
        borderBottom: '1px solid #2a2a3e',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        zIndex: 50,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          style={{
            display: 'inline-block',
            width: 10,
            height: 10,
            borderRadius: '50%',
            backgroundColor: connected ? '#51cf66' : '#ff6b6b',
            border: '2px solid rgba(255,255,255,0.15)',
          }}
        />
        <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: 1, color: '#eee' }}>
          Agent Matrix
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <HeaderButton onClick={onSessionsClick} label="Sessions" title="Browse active sessions" badge={sessionCount} />
        <HeaderButton onClick={onResumeClick} label="Resume Session" title="Resume a past session" />
        <HeaderButton onClick={onTasksClick} label="Tasks" title="View task board" />
        <HeaderButton onClick={onSetupClick} label="Setup" title="Hook configuration" />
      </div>
    </header>
  );
}
