'use client';

import { useState, useEffect, useCallback } from 'react';
import { DiffEditor } from '@monaco-editor/react';

interface GitFile {
  path: string;
  status: string;
  staged: boolean;
}

interface GitPanelProps {
  rootPath: string;
  height: number;
  onResize: (height: number) => void;
}

function statusColor(status: string): string {
  switch (status) {
    case 'M': return '#ff922b';
    case 'A': return '#51cf66';
    case 'D': return '#ff6b6b';
    case '?': return '#888';
    case 'R': return '#4a9eff';
    case 'C': return '#20c997';
    default: return '#888';
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'M': return 'M';
    case 'A': return 'A';
    case 'D': return 'D';
    case '?': return '?';
    case 'R': return 'R';
    case 'C': return 'C';
    default: return status;
  }
}

export default function GitPanel({ rootPath, height, onResize }: GitPanelProps) {
  const [files, setFiles] = useState<GitFile[]>([]);
  const [currentBranch, setCurrentBranch] = useState('');
  const [branches, setBranches] = useState<string[]>([]);
  const [showBranches, setShowBranches] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diffOriginal, setDiffOriginal] = useState('');
  const [diffModified, setDiffModified] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchStatus = useCallback(async () => {
    if (!rootPath) return;
    try {
      const res = await fetch(`/api/editor/git?action=status&cwd=${encodeURIComponent(rootPath)}`);
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      setFiles(data.files || []);
      setError('');
    } catch {
      setError('Failed to get git status');
    }
  }, [rootPath]);

  const fetchBranches = useCallback(async () => {
    if (!rootPath) return;
    try {
      const res = await fetch(`/api/editor/git?action=branches&cwd=${encodeURIComponent(rootPath)}`);
      const data = await res.json();
      if (!data.error) {
        setCurrentBranch(data.current || '');
        setBranches(data.branches || []);
      }
    } catch {
      // ignore
    }
  }, [rootPath]);

  useEffect(() => {
    fetchStatus();
    fetchBranches();
  }, [fetchStatus, fetchBranches]);

  const handleStage = useCallback(async (filePaths: string[]) => {
    try {
      await fetch('/api/editor/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stage', cwd: rootPath, files: filePaths }),
      });
      await fetchStatus();
    } catch (err) {
      console.error('Stage failed:', err);
    }
  }, [rootPath, fetchStatus]);

  const handleUnstage = useCallback(async (filePaths: string[]) => {
    try {
      await fetch('/api/editor/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unstage', cwd: rootPath, files: filePaths }),
      });
      await fetchStatus();
    } catch (err) {
      console.error('Unstage failed:', err);
    }
  }, [rootPath, fetchStatus]);

  const handleCommit = useCallback(async () => {
    if (!commitMessage.trim()) return;
    setLoading(true);
    try {
      const res = await fetch('/api/editor/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'commit', cwd: rootPath, message: commitMessage }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setCommitMessage('');
        setError('');
        await fetchStatus();
      }
    } catch {
      setError('Commit failed');
    }
    setLoading(false);
  }, [commitMessage, rootPath, fetchStatus]);

  const handleCheckout = useCallback(async (branch: string) => {
    setShowBranches(false);
    try {
      await fetch('/api/editor/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'checkout', cwd: rootPath, branch }),
      });
      await fetchBranches();
      await fetchStatus();
    } catch (err) {
      console.error('Checkout failed:', err);
    }
  }, [rootPath, fetchBranches, fetchStatus]);

  const handleViewDiff = useCallback(async (filePath: string) => {
    setSelectedFile(filePath);
    try {
      // Get original content (HEAD version)
      const fullPath = rootPath + '/' + filePath;
      let original = '';
      try {
        const res = await fetch(`/api/editor?action=read&path=${encodeURIComponent(fullPath)}`);
        const data = await res.json();
        if (!data.error) original = data.content || '';
      } catch {
        // new file, no original
      }

      // Get diff from git
      const diffRes = await fetch(`/api/editor/git?action=diff&cwd=${encodeURIComponent(rootPath)}&file=${encodeURIComponent(filePath)}`);
      const diffData = await diffRes.json();

      // For the diff editor, we show original vs modified
      // The "modified" is the current file content, "original" is the last committed version
      // We can approximate by reading the file and using original = modified - diff
      // Simpler: just show current file as modified, and use git show for original
      setDiffModified(original);

      // Try to get HEAD version
      try {
        const res2 = await fetch(`/api/editor/git?action=diff&cwd=${encodeURIComponent(rootPath)}&file=${encodeURIComponent(filePath)}`);
        const d2 = await res2.json();
        // Use the diff text for display. For proper diff editor, we'd need git show HEAD:file
        // For now, show the raw diff
        setDiffOriginal(d2.diff || d2.stagedDiff || '(no changes)');
      } catch {
        setDiffOriginal('');
      }
    } catch {
      setDiffOriginal('');
      setDiffModified('');
    }
  }, [rootPath]);

  // Resize handle
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = height;

    const onMove = (ev: MouseEvent) => {
      const delta = startY - ev.clientY;
      onResize(Math.max(100, Math.min(600, startHeight + delta)));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [height, onResize]);

  const stagedFiles = files.filter(f => f.staged);
  const unstagedFiles = files.filter(f => !f.staged);

  return (
    <div style={{ height, display: 'flex', flexDirection: 'column', background: '#12121e', borderTop: '1px solid #2a2a3a' }}>
      {/* Resize handle */}
      <div
        onMouseDown={handleResizeStart}
        style={{
          height: 4,
          cursor: 'row-resize',
          background: '#1a1a2e',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div style={{ width: 40, height: 2, background: '#3a3a4e', borderRadius: 1 }} />
      </div>

      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 12px',
        borderBottom: '1px solid #1a1a2e',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#e0e0e0' }}>SOURCE CONTROL</span>

          {/* Branch */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowBranches(!showBranches)}
              style={{
                padding: '2px 8px',
                borderRadius: 4,
                border: '1px solid #2a2a3a',
                background: 'transparent',
                color: '#4a9eff',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {currentBranch || 'no branch'}
            </button>
            {showBranches && (
              <div style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                marginTop: 4,
                background: '#1a1a2a',
                border: '1px solid #2a2a3e',
                borderRadius: 6,
                minWidth: 180,
                maxHeight: 200,
                overflowY: 'auto',
                zIndex: 100,
                boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
              }}>
                {branches.map(b => (
                  <div
                    key={b}
                    onClick={() => handleCheckout(b)}
                    style={{
                      padding: '6px 12px',
                      fontSize: 12,
                      color: b === currentBranch ? '#4a9eff' : '#e0e0e0',
                      cursor: 'pointer',
                      fontWeight: b === currentBranch ? 700 : 400,
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#222238')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    {b === currentBranch ? '\u2713 ' : '  '}{b}
                  </div>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={fetchStatus}
            style={{
              padding: '2px 8px',
              borderRadius: 4,
              border: 'none',
              background: 'transparent',
              color: '#888',
              fontSize: 14,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
            title="Refresh"
          >
            {'\u21BB'}
          </button>
        </div>

        {/* Commit area */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            value={commitMessage}
            onChange={e => setCommitMessage(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCommit(); }}
            placeholder="Commit message..."
            style={{
              width: 200,
              padding: '4px 8px',
              borderRadius: 4,
              border: '1px solid #2a2a3a',
              background: '#0e0e1a',
              color: '#e0e0e0',
              fontSize: 12,
              outline: 'none',
              fontFamily: 'inherit',
            }}
          />
          <button
            onClick={handleCommit}
            disabled={loading || !commitMessage.trim()}
            style={{
              padding: '4px 12px',
              borderRadius: 4,
              border: 'none',
              background: commitMessage.trim() ? '#4a9eff' : '#2a2a3a',
              color: commitMessage.trim() ? '#fff' : '#666',
              fontSize: 12,
              fontWeight: 600,
              cursor: commitMessage.trim() ? 'pointer' : 'default',
              fontFamily: 'inherit',
            }}
          >
            Commit
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '4px 12px', fontSize: 11, color: '#ff6b6b', background: '#1a0a0a' }}>
          {error}
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* File list */}
        <div style={{
          width: 280,
          overflowY: 'auto',
          borderRight: '1px solid #1a1a2e',
          flexShrink: 0,
        }}>
          {/* Staged files */}
          {stagedFiles.length > 0 && (
            <>
              <div style={{
                padding: '4px 10px',
                fontSize: 11,
                fontWeight: 700,
                color: '#51cf66',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}>
                <span>Staged ({stagedFiles.length})</span>
                <button
                  onClick={() => handleUnstage(stagedFiles.map(f => f.path))}
                  style={{
                    padding: '1px 6px',
                    border: 'none',
                    borderRadius: 3,
                    background: 'transparent',
                    color: '#888',
                    fontSize: 10,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                  title="Unstage all"
                >
                  {'\u2212'} All
                </button>
              </div>
              {stagedFiles.map(f => (
                <FileItem
                  key={'s-' + f.path}
                  file={f}
                  selected={selectedFile === f.path}
                  onClick={() => handleViewDiff(f.path)}
                  onAction={() => handleUnstage([f.path])}
                  actionLabel={'\u2212'}
                  actionTitle="Unstage"
                />
              ))}
            </>
          )}

          {/* Unstaged files */}
          {unstagedFiles.length > 0 && (
            <>
              <div style={{
                padding: '4px 10px',
                fontSize: 11,
                fontWeight: 700,
                color: '#ff922b',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}>
                <span>Changes ({unstagedFiles.length})</span>
                <button
                  onClick={() => handleStage(unstagedFiles.map(f => f.path))}
                  style={{
                    padding: '1px 6px',
                    border: 'none',
                    borderRadius: 3,
                    background: 'transparent',
                    color: '#888',
                    fontSize: 10,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                  title="Stage all"
                >
                  + All
                </button>
              </div>
              {unstagedFiles.map(f => (
                <FileItem
                  key={'u-' + f.path}
                  file={f}
                  selected={selectedFile === f.path}
                  onClick={() => handleViewDiff(f.path)}
                  onAction={() => handleStage([f.path])}
                  actionLabel="+"
                  actionTitle="Stage"
                />
              ))}
            </>
          )}

          {files.length === 0 && !error && (
            <div style={{ padding: '12px', fontSize: 12, color: '#666', textAlign: 'center' }}>
              No changes
            </div>
          )}
        </div>

        {/* Diff view */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {selectedFile ? (
            <DiffEditor
              original={diffOriginal}
              modified={diffModified}
              language="plaintext"
              theme="vs-dark"
              options={{
                readOnly: true,
                minimap: { enabled: false },
                fontSize: 12,
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                renderSideBySide: true,
                automaticLayout: true,
              }}
            />
          ) : (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: '#555',
              fontSize: 13,
            }}>
              Select a file to view diff
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FileItem({
  file,
  selected,
  onClick,
  onAction,
  actionLabel,
  actionTitle,
}: {
  file: GitFile;
  selected: boolean;
  onClick: () => void;
  onAction: () => void;
  actionLabel: string;
  actionTitle: string;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '3px 10px',
        fontSize: 12,
        cursor: 'pointer',
        background: selected ? 'rgba(74, 158, 255, 0.1)' : hovered ? 'rgba(255,255,255,0.03)' : 'transparent',
        color: '#c8c8d8',
      }}
    >
      <span style={{
        width: 14,
        fontSize: 11,
        fontWeight: 700,
        color: statusColor(file.status),
        flexShrink: 0,
      }}>
        {statusLabel(file.status)}
      </span>
      <span style={{
        flex: 1,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        marginLeft: 4,
      }}>
        {file.path}
      </span>
      {hovered && (
        <button
          onClick={(e) => { e.stopPropagation(); onAction(); }}
          title={actionTitle}
          style={{
            width: 18,
            height: 18,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 3,
            border: 'none',
            background: 'rgba(255,255,255,0.1)',
            color: '#e0e0e0',
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
            flexShrink: 0,
            fontFamily: 'inherit',
          }}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
