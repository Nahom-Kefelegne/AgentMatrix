'use client';

import { useState, useRef, useEffect } from 'react';

interface FloatingSpriteProps {
  dataURL: string;
  name: string;
  color: string;
  startX: number;
  startY: number;
  /** Right edge X the sprite must not cross (e.g. dialog left edge) */
  boundaryRight: number;
  /** Vertical center Y target */
  targetY: number;
  /** Gap between sprite's right edge and boundaryRight */
  gap?: number;
  animated: boolean;
}

export default function FloatingSprite({
  dataURL, name, color, startX, startY,
  boundaryRight, targetY, gap = 30, animated,
}: FloatingSpriteProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [measuredWidth, setMeasuredWidth] = useState(120);

  // Measure actual rendered width so we can position the right edge correctly
  useEffect(() => {
    if (containerRef.current && animated) {
      setMeasuredWidth(containerRef.current.offsetWidth);
    }
  }, [animated, name]);

  // Target X: position so the right edge of the container = boundaryRight - gap
  const scaledWidth = measuredWidth * 1.5; // account for CSS scale
  const computedTargetX = boundaryRight - gap - scaledWidth / 2;
  const safeTargetX = Math.max(60, computedTargetX);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        left: animated ? safeTargetX : startX,
        top: animated ? targetY : startY,
        transform: animated
          ? 'translate(-50%, -50%) scale(1.5)'
          : 'translate(-50%, -50%) scale(1)',
        transition: 'all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
        zIndex: 102,
        pointerEvents: 'none',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        opacity: animated ? 1 : 0.7,
      }}
    >
      <img
        src={dataURL}
        alt={name}
        style={{
          width: 48,
          height: 48,
          imageRendering: 'pixelated',
          filter: animated ? `drop-shadow(0 0 10px ${color}60)` : 'none',
          transition: 'filter 0.3s ease',
        }}
      />
      {animated && (
        <div style={{
          fontSize: 13,
          fontWeight: 700,
          color: '#fff',
          textShadow: '0 2px 8px rgba(0,0,0,0.8)',
          whiteSpace: 'nowrap',
          transition: 'opacity 0.3s ease 0.2s',
        }}>
          {name}
        </div>
      )}
    </div>
  );
}
