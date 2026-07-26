'use client';

// Centered spinner used while a file diff/content is being fetched.
export function LoadingSpinner() {
  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10 }}>
      <div style={{ width: 24, height: 24, border: '3px solid #222', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
      <span style={{ fontSize: 13, color: '#555' }}>Loading...</span>
    </div>
  );
}

// Placeholder shown by Monaco while the editor bundle initializes.
export function EditorLoading() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#888', fontSize: 14, background: '#0f0f13' }}>
      Loading editor...
    </div>
  );
}

// Full-height error surface for a failed diff/content fetch.
export function EditorError({ message }: { message: string }) {
  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8, padding: 24, textAlign: 'center' }}>
      <div style={{ fontSize: 14, color: '#ff6b6b', fontWeight: 600 }}>Something went wrong</div>
      <div style={{ fontSize: 12, color: '#71717a', maxWidth: 420, lineHeight: 1.5 }}>{message}</div>
    </div>
  );
}
