'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSocketContext } from './SocketProvider';

interface HandoffModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceSessionId: string;
  sourceCwd?: string;
  onNewSession?: (sessionId: string) => void;
  onStatusChange?: (active: boolean) => void;
}

type HandoffStatus = 'idle' | 'summarizing' | 'spawning' | 'injecting' | 'done' | 'error';

const STATUS_LABELS: Record<HandoffStatus, string> = {
  idle: '',
  summarizing: 'Source session generating context summary...',
  spawning: 'Spawning new session...',
  injecting: 'Injecting context into new session...',
  done: 'Handoff complete!',
  error: 'Handoff failed',
};

const MODELS = [
  { value: '', label: 'Default' },
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' },
];

const PERMISSION_MODES = [
  { value: 'bypassPermissions', label: 'Skip Permissions' },
  { value: 'default', label: 'Default' },
  { value: 'acceptEdits', label: 'Accept Edits' },
  { value: 'plan', label: 'Plan' },
  { value: 'auto', label: 'Auto' },
];

const EFFORT_LEVELS = [
  { value: '', label: 'Default' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

export default function HandoffModal({ isOpen, onClose, sourceSessionId, sourceCwd, onNewSession, onStatusChange }: HandoffModalProps) {
  const { socketRef } = useSocketContext();
  const [contextRequest, setContextRequest] = useState('');
  const [targetCwd, setTargetCwd] = useState(sourceCwd || '');
  const [sessionName, setSessionName] = useState('');
  const [permissionMode, setPermissionMode] = useState('bypassPermissions');
  const [model, setModel] = useState('');
  const [effort, setEffort] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [status, setStatus] = useState<HandoffStatus>('idle');
  const [error, setError] = useState('');
  const [handoffId, setHandoffId] = useState('');
  const [newSessionId, setNewSessionId] = useState<string | null>(null);

  // Only reset when opening fresh (not when resuming an active handoff)
  useEffect(() => {
    if (isOpen && status !== 'summarizing' && status !== 'spawning' && status !== 'injecting') {
      setTargetCwd(sourceCwd || '');
    }
  }, [isOpen, sourceCwd, status]);

  // Listen for handoff status updates
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !handoffId) return;

    const handler = (data: { handoffId: string; status: string; error?: string; newSessionId?: string }) => {
      if (data.handoffId !== handoffId) return;
      const s = data.status as HandoffStatus;
      setStatus(s);
      if (data.error) setError(data.error);
      if (data.newSessionId) setNewSessionId(data.newSessionId);
      const active = s === 'summarizing' || s === 'spawning' || s === 'injecting';
      if (onStatusChange) onStatusChange(active);
    };

    socket.on('session:handoff-status' as any, handler);
    return () => { socket.off('session:handoff-status' as any, handler); };
  }, [socketRef, handoffId]);

  const handleStart = useCallback(() => {
    if (!contextRequest.trim()) return;
    const socket = socketRef.current;
    if (!socket) return;

    const id = `hf-${Date.now().toString(36)}`;
    setHandoffId(id);
    setStatus('summarizing');
    setError('');
    setNewSessionId(null);
    if (onStatusChange) onStatusChange(true);

    socket.emit('session:handoff' as any, {
      sourceSessionId,
      contextRequest: contextRequest.trim(),
      targetCwd: targetCwd || sourceCwd || '~',
      handoffId: id,
      sessionName: sessionName.trim() || undefined,
      permissionMode,
      model: model || undefined,
      effort: effort || undefined,
    });
  }, [contextRequest, targetCwd, sourceCwd, sourceSessionId, socketRef, sessionName, permissionMode, model, effort]);

  const handleOpenNewSession = useCallback(() => {
    if (newSessionId && onNewSession) {
      onNewSession(newSessionId);
      onClose();
    }
  }, [newSessionId, onNewSession, onClose]);

  if (!isOpen) return null;

  const isProcessing = status === 'summarizing' || status === 'spawning' || status === 'injecting';

  const pillStyle = (active: boolean) => ({
    padding: '5px 12px', borderRadius: 6, fontSize: 13, fontWeight: 600 as const,
    border: active ? '1px solid #4a9eff' : '1px solid #2a2a3e',
    background: active ? '#152540' : '#1a1a2a',
    color: active ? '#7aafff' : '#888',
    cursor: isProcessing ? 'default' as const : 'pointer' as const,
    fontFamily: 'inherit',
    opacity: isProcessing ? 0.5 : 1,
  });

  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200,
      }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 540, maxHeight: '85vh', background: '#151520', border: '1px solid #2a2a3e',
        borderRadius: 12, zIndex: 201, display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid #1e1e30',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ fontSize: 18, fontWeight: 700, color: '#eee' }}>Transfer Context</span>
          <button onClick={onClose} style={{
            width: 28, height: 28, borderRadius: 6, border: '1px solid #3a3a4e',
            background: '#1e1e30', color: '#aaa', fontSize: 14,
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          }}>X</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Context request */}
          <div>
            <div style={{ fontSize: 14, color: '#b0b0c8', fontWeight: 600, marginBottom: 6 }}>
              What context to transfer?
            </div>
            <textarea
              value={contextRequest}
              onChange={e => setContextRequest(e.target.value)}
              placeholder="e.g. Everything about the auth refactor, API changes, and pending test fixes..."
              rows={3}
              disabled={isProcessing}
              style={{
                width: '100%', background: '#1a1a2a', border: '1px solid #2a2a3e',
                color: '#eee', borderRadius: 6, padding: '10px 14px', fontSize: 14,
                fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.5,
                opacity: isProcessing ? 0.5 : 1,
              }}
            />
          </div>

          {/* Session name */}
          <div>
            <div style={{ fontSize: 14, color: '#b0b0c8', fontWeight: 600, marginBottom: 6 }}>
              New session name
            </div>
            <input
              value={sessionName}
              onChange={e => setSessionName(e.target.value)}
              placeholder="Optional..."
              disabled={isProcessing}
              style={{
                width: '100%', background: '#1a1a2a', border: '1px solid #2a2a3e',
                color: '#eee', borderRadius: 6, padding: '10px 14px', fontSize: 14,
                fontFamily: 'inherit', opacity: isProcessing ? 0.5 : 1,
              }}
            />
          </div>

          {/* Target CWD */}
          <div>
            <div style={{ fontSize: 14, color: '#b0b0c8', fontWeight: 600, marginBottom: 6 }}>
              Working directory
            </div>
            <input
              value={targetCwd}
              onChange={e => setTargetCwd(e.target.value)}
              disabled={isProcessing}
              style={{
                width: '100%', background: '#1a1a2a', border: '1px solid #2a2a3e',
                color: '#eee', borderRadius: 6, padding: '10px 14px', fontSize: 14,
                fontFamily: "'Courier New', monospace", opacity: isProcessing ? 0.5 : 1,
              }}
            />
          </div>

          {/* Permission mode */}
          <div>
            <div style={{ fontSize: 14, color: '#b0b0c8', fontWeight: 600, marginBottom: 6 }}>
              Permission mode
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {PERMISSION_MODES.map(pm => (
                <button key={pm.value} onClick={() => !isProcessing && setPermissionMode(pm.value)}
                  style={pillStyle(permissionMode === pm.value)}>
                  {pm.label}
                </button>
              ))}
            </div>
          </div>

          {/* Advanced toggle */}
          <button onClick={() => setShowAdvanced(!showAdvanced)} style={{
            fontSize: 13, color: '#666', background: 'none', border: 'none',
            cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', padding: 0,
          }}>
            {showAdvanced ? '▼ Hide advanced' : '▶ Advanced options'}
          </button>

          {showAdvanced && (
            <>
              <div>
                <div style={{ fontSize: 14, color: '#b0b0c8', fontWeight: 600, marginBottom: 6 }}>Model</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {MODELS.map(m => (
                    <button key={m.value} onClick={() => !isProcessing && setModel(m.value)}
                      style={pillStyle(model === m.value)}>
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 14, color: '#b0b0c8', fontWeight: 600, marginBottom: 6 }}>Effort</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {EFFORT_LEVELS.map(e => (
                    <button key={e.value} onClick={() => !isProcessing && setEffort(e.value)}
                      style={pillStyle(effort === e.value)}>
                      {e.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Status */}
          {status !== 'idle' && (
            <div style={{
              padding: '12px 14px', borderRadius: 8,
              background: status === 'error' ? '#1a0e0e' : status === 'done' ? '#0e1a0e' : '#0e1a2e',
              border: `1px solid ${status === 'error' ? '#ff6b6b30' : status === 'done' ? '#51cf6640' : '#4a9eff30'}`,
            }}>
              {isProcessing && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 16, height: 16, border: '2px solid #2a2a3e', borderTopColor: '#4a9eff',
                    borderRadius: '50%', animation: 'spin 0.8s linear infinite',
                  }} />
                  <span style={{ fontSize: 14, color: '#7aafff' }}>{STATUS_LABELS[status]}</span>
                  <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                </div>
              )}
              {status === 'done' && (
                <div style={{ fontSize: 14, color: '#51cf66', fontWeight: 600 }}>{STATUS_LABELS.done}</div>
              )}
              {status === 'error' && (
                <div style={{ fontSize: 14, color: '#ff6b6b' }}>{error || STATUS_LABELS.error}</div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 20px', borderTop: '1px solid #1e1e30',
          display: 'flex', justifyContent: 'flex-end', gap: 8,
        }}>
          <button onClick={onClose} style={{
            padding: '8px 16px', borderRadius: 6, border: '1px solid #3a3a4e',
            background: '#1e1e30', color: '#aaa', fontSize: 14, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>
            {status === 'done' ? 'Close' : 'Cancel'}
          </button>
          {status === 'done' && newSessionId ? (
            <button onClick={handleOpenNewSession} style={{
              padding: '8px 16px', borderRadius: 6, border: 'none',
              background: '#4a9eff', color: '#fff', fontSize: 14, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
            }}>
              Open New Session
            </button>
          ) : (
            <button
              onClick={handleStart}
              disabled={!contextRequest.trim() || isProcessing}
              style={{
                padding: '8px 16px', borderRadius: 6, border: 'none',
                background: contextRequest.trim() && !isProcessing ? '#cc5de8' : '#1e1e30',
                color: contextRequest.trim() && !isProcessing ? '#fff' : '#555',
                fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              {isProcessing ? 'Transferring...' : 'Transfer'}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
