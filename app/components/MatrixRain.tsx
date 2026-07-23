'use client';

import { useMemo } from 'react';

const RAIN_CHARS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEF<>{}[]|/\\+=*';

/**
 * MatrixRain — Falling character columns. Always renders the DOM,
 * visibility controlled via CSS class on the parent card.
 */
export default function MatrixRain({ sessionId }: { sessionId: string }) {
  const columns = useMemo(() => {
    const count = 12;
    let hash = 0;
    for (let i = 0; i < sessionId.length; i++) {
      hash = ((hash << 5) - hash + sessionId.charCodeAt(i)) | 0;
    }
    const cols: { left: number; chars: string[]; duration: number; delay: number }[] = [];
    for (let i = 0; i < count; i++) {
      hash = ((hash << 13) ^ hash) - 1;
      const charCount = 4 + Math.abs(hash % 6);
      const chars: string[] = [];
      for (let j = 0; j < charCount; j++) {
        hash = ((hash << 7) ^ hash) + 1;
        chars.push(RAIN_CHARS[Math.abs(hash) % RAIN_CHARS.length]);
      }
      cols.push({
        left: (i / count) * 100,
        chars,
        duration: 2 + Math.abs((hash >> 4) % 30) / 10,
        delay: Math.abs((hash >> 8) % 40) / 10,
      });
    }
    return cols;
  }, [sessionId]);

  return (
    <div className="matrix-rain-bg">
      {columns.map((col, i) => (
        <div key={i} className="matrix-rain-col"
          style={{
            left: `${col.left}%`,
            '--fall-duration': `${col.duration}s`,
            '--fall-delay': `${col.delay}s`,
          } as React.CSSProperties}>
          {col.chars.map((ch, j) => (
            <span key={j} className="matrix-rain-char">{ch}</span>
          ))}
        </div>
      ))}
    </div>
  );
}
