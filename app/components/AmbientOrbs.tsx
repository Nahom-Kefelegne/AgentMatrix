'use client';

/**
 * AmbientOrbs — Floating gradient blobs that drift behind the dashboard.
 * Pure CSS animations, no JS overhead. Just mount and forget.
 */
export default function AmbientOrbs() {
  return (
    <div className="ambient-orbs">
      <div className="ambient-orb ambient-orb--1" />
      <div className="ambient-orb ambient-orb--2" />
      <div className="ambient-orb ambient-orb--3" />
    </div>
  );
}
