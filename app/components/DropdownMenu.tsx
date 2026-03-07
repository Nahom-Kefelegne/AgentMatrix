'use client';

import { useRef, useEffect } from 'react';

export interface DropdownItem {
  label: string;
  onClick: () => void;
}

interface DropdownMenuProps {
  items: DropdownItem[];
  onClose: () => void;
}

export default function DropdownMenu({ items, onClose }: DropdownMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  return (
    <div ref={ref} style={{
      position: 'absolute', top: '100%', right: 0, marginTop: 6,
      background: '#1a1a2a', border: '1px solid #3a3a4e', borderRadius: 8,
      minWidth: 160, overflow: 'hidden', zIndex: 100,
      boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
    }}>
      {items.map((item, i) => (
        <button
          key={i}
          onClick={() => { item.onClick(); onClose(); }}
          style={{
            width: '100%', padding: '10px 16px', border: 'none',
            background: 'transparent', color: '#ccc', fontSize: 15,
            fontWeight: 500, textAlign: 'left', cursor: 'pointer',
            fontFamily: 'inherit',
            borderBottom: i < items.length - 1 ? '1px solid #222238' : 'none',
          }}
          onMouseEnter={e => e.currentTarget.style.background = '#222238'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
