'use client';

import { useMemo } from 'react';
import type { FileChange, ReviewComment } from './types';
import { statusColors } from './editorConfig';

interface ChangedFilesListProps {
  files: FileChange[];
  selectedFile: string | null;
  onSelect: (path: string) => void;
  comments: ReviewComment[];
  loading: boolean;
  error?: string | null;
}

// The changes-mode sidebar: a flat, scrollable list of changed files with
// status/additions/deletions and a per-file comment badge. Rows use
// content-visibility so very large change sets stay cheap to scroll.
export function ChangedFilesList({ files, selectedFile, onSelect, comments, loading, error }: ChangedFilesListProps) {
  // Pre-aggregate comment counts once instead of scanning per row.
  const commentCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of comments) map.set(c.filePath, (map.get(c.filePath) || 0) + 1);
    return map;
  }, [comments]);

  if (loading) {
    return (
      <div style={{ padding: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8 }}>
        <div style={{ width: 20, height: 20, border: '2px solid #222', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        <span style={{ fontSize: 12, color: '#555' }}>Loading files...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 20, color: '#ff6b6b', textAlign: 'center', fontSize: 12, lineHeight: 1.5 }}>
        Failed to load changes.
        <div style={{ color: '#71717a', marginTop: 4, fontSize: 11 }}>{error}</div>
      </div>
    );
  }

  if (files.length === 0) {
    return <div style={{ padding: 20, color: '#555', textAlign: 'center' }}>No file changes tracked yet</div>;
  }

  return (
    <>
      {files.map(f => {
        const name = f.path.split('/').pop() || f.path.split('\\').pop() || f.path;
        const dir = f.path.replace(/[/\\][^/\\]+$/, '');
        const isSelected = selectedFile === f.path;
        const commentCount = commentCounts.get(f.path) || 0;
        return (
          <div key={f.path} onClick={() => onSelect(f.path)}
            className={isSelected ? '' : 'cv-row'}
            style={{
              padding: '10px 14px', cursor: 'pointer',
              background: isSelected ? '#1e1e26' : 'transparent',
              borderBottom: '1px solid #24242c',
              borderLeft: `3px solid ${isSelected ? (statusColors[f.status] || '#888') : 'transparent'}`,
              contentVisibility: 'auto',
              containIntrinsicSize: 'auto 58px',
            }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: isSelected ? '#fafafa' : '#c8c8d0' }}>{name}</div>
              {commentCount > 0 && (
                <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 8, background: '#fbbf2420', color: '#fbbf24', fontWeight: 700 }}>{commentCount}</span>
              )}
            </div>
            <div style={{ fontSize: 11, color: '#71717a', fontFamily: "'Courier New', monospace", marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dir}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 5, fontSize: 11, alignItems: 'center' }}>
              <span style={{
                color: statusColors[f.status] || '#888', fontWeight: 700,
                fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.03em',
                padding: '1px 7px', borderRadius: 5,
                background: `${statusColors[f.status] || '#888'}1a`,
              }}>{f.status}</span>
              {f.additions > 0 && <span style={{ color: '#51cf66', fontWeight: 600 }}>+{f.additions}</span>}
              {f.deletions > 0 && <span style={{ color: '#ff6b6b', fontWeight: 600 }}>-{f.deletions}</span>}
            </div>
          </div>
        );
      })}
    </>
  );
}
