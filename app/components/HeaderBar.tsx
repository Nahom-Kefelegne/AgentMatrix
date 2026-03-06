'use client';

interface HeaderBarProps {
  connected: boolean;
  onSetupClick: () => void;
  onTasksClick: () => void;
}

function HeaderButton({ onClick, label, title }: { onClick: () => void; label: string; title: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        padding: '6px 14px',
        borderRadius: 6,
        border: '1px solid #3a3a4e',
        background: '#1e1e30',
        color: '#c8c8d8',
        fontSize: 14,
        fontWeight: 600,
        fontFamily: 'inherit',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

export default function HeaderBar({ connected, onSetupClick, onTasksClick }: HeaderBarProps) {
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
        <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: 1, color: '#eee' }}>
          Agent Matrix
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <HeaderButton onClick={onTasksClick} label="Tasks" title="View task board" />
        <HeaderButton onClick={onSetupClick} label="Setup" title="Hook configuration" />
      </div>
    </header>
  );
}
