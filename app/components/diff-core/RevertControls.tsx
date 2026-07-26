'use client';

interface RevertControlsProps {
  selectedFile: string | null;
  reverting: boolean;
  onRevertFile: () => void;
  onRevertAll: () => void;
}

// Revert-file / revert-all buttons for the changes footer.
export function RevertControls({ selectedFile, reverting, onRevertFile, onRevertAll }: RevertControlsProps) {
  return (
    <>
      <button onClick={onRevertFile} disabled={!selectedFile || reverting} style={{
        padding: '6px 14px', borderRadius: 6, border: '1px solid #ff6b6b30',
        background: 'transparent', color: selectedFile ? '#ff6b6b' : '#555',
        fontSize: 12, fontWeight: 600, cursor: selectedFile ? 'pointer' : 'default', fontFamily: 'inherit',
      }}>Revert File</button>
      <button onClick={onRevertAll} disabled={reverting} style={{
        padding: '6px 14px', borderRadius: 6, border: '1px solid #ff6b6b30',
        background: 'transparent', color: '#ff6b6b', fontSize: 12, fontWeight: 600,
        cursor: 'pointer', fontFamily: 'inherit',
      }}>Revert All</button>
    </>
  );
}
