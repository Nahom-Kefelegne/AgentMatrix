'use client';

interface ConnectionDotProps {
  connected: boolean;
}

function ConnectionDot({ connected }: ConnectionDotProps) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        backgroundColor: connected ? '#51cf66' : '#ff6b6b',
        marginRight: 8,
      }}
    />
  );
}

interface HeaderBarProps {
  connected: boolean;
  onSetupClick: () => void;
}

export default function HeaderBar({ connected, onSetupClick }: HeaderBarProps) {
  return (
    <header
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: 'var(--header-height)',
        background: 'rgba(10, 10, 20, 0.85)',
        backdropFilter: 'blur(8px)',
        borderBottom: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        zIndex: 50,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <ConnectionDot connected={connected} />
        <span style={{ fontSize: 14, fontWeight: 'bold', letterSpacing: 1 }}>
          Claude Office
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={onSetupClick}
          style={{
            width: 28,
            height: 28,
            borderRadius: 4,
            border: '1px solid var(--border-color)',
            background: 'var(--bg-tertiary)',
            color: 'var(--text-secondary)',
            fontSize: 14,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          title="Setup"
        >
          +
        </button>
      </div>
    </header>
  );
}
