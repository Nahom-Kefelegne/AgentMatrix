'use client';

import { useState, useEffect, useCallback } from 'react';
import { ArrowRightLeft } from 'lucide-react';
import {
  COPILOT_MODES,
  EFFORT_LEVELS,
  modelsForCli,
  permissionModesForCli,
} from '@/lib/cli/uiMetadata';
import { useSocketContext } from './SocketProvider';
import {
  FormField,
  Modal,
  OptionButton,
  OptionGroup,
  SelectInput,
  TextArea,
  TextInput,
} from './ui/Modal';

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

export default function HandoffModal({ isOpen, onClose, sourceSessionId, sourceCwd, onNewSession, onStatusChange }: HandoffModalProps) {
  const { sessions, socketRef } = useSocketContext();
  const rawSourceCliType = sessions.get(sourceSessionId)?.cliType;
  const sourceCliType = rawSourceCliType === 'copilot' || rawSourceCliType === 'claude'
    ? rawSourceCliType
    : undefined;
  const formCliType = sourceCliType || 'claude';
  const [contextRequest, setContextRequest] = useState('');
  const [targetCwd, setTargetCwd] = useState(sourceCwd || '');
  const [sessionName, setSessionName] = useState('');
  const [permissionMode, setPermissionMode] = useState('');
  const [model, setModel] = useState('');
  const [effort, setEffort] = useState('');
  const [copilotMode, setCopilotMode] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [status, setStatus] = useState<HandoffStatus>('idle');
  const [error, setError] = useState('');
  const [handoffId, setHandoffId] = useState('');
  const [newSessionId, setNewSessionId] = useState<string | null>(null);

  // Only reset when opening fresh (not when resuming an active handoff)
  useEffect(() => {
    if (isOpen && status !== 'summarizing' && status !== 'spawning' && status !== 'injecting') {
      setTargetCwd(sourceCwd || '');
      setPermissionMode('');
      setModel('');
      setEffort('');
      setCopilotMode('');
    }
  }, [formCliType, isOpen, sourceCwd, status]);

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
      permissionMode: permissionMode || undefined,
      model: model || undefined,
      effort: effort || undefined,
      cliType: sourceCliType,
      copilotMode: formCliType === 'copilot' ? copilotMode || undefined : undefined,
    });
  }, [contextRequest, targetCwd, sourceCwd, sourceSessionId, socketRef, sessionName, permissionMode, model, effort, sourceCliType, formCliType, copilotMode]);

  const handleOpenNewSession = useCallback(() => {
    if (newSessionId && onNewSession) {
      onNewSession(newSessionId);
      onClose();
    }
  }, [newSessionId, onNewSession, onClose]);

  if (!isOpen) return null;

  const isProcessing = status === 'summarizing' || status === 'spawning' || status === 'injecting';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Continue in Fresh Session"
      eyebrow="Context Handoff"
      description="Summarize the relevant context, start a fresh CLI session, and inject the handoff automatically."
      icon={<ArrowRightLeft size={16} />}
      maxWidth={620}
      bodyClassName="cc-handoff-body"
      footer={(
        <div className="cc-modal-footer-row">
          <span className="cc-modal-footer-status" role="status" aria-live="polite">
            {status === 'error' ? error || STATUS_LABELS.error : isProcessing ? STATUS_LABELS[status] : ''}
          </span>
          <button type="button" className="btn-outline" onClick={onClose}>
            {isProcessing ? 'Hide' : status === 'done' ? 'Close' : 'Cancel'}
          </button>
          {status === 'done' && newSessionId ? (
            <button type="button" className="btn-primary" onClick={handleOpenNewSession}>
              Open New Session
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary"
              onClick={handleStart}
              disabled={!contextRequest.trim() || isProcessing}
            >
              {isProcessing ? 'Transferring…' : 'Continue'}
            </button>
          )}
        </div>
      )}
    >
        <div className="cc-handoff-layout">
          <FormField
            label="Context to transfer"
            description="Describe the decisions, files, and unfinished work the new session needs."
            required
          >
            <TextArea
              data-autofocus
              name="handoff-context"
              autoComplete="off"
              value={contextRequest}
              onChange={setContextRequest}
              placeholder="Everything about the auth refactor, API changes, and pending test fixes…"
              rows={4}
              disabled={isProcessing}
            />
          </FormField>

          <FormField label="New session name" optional>
            <TextInput
              name="handoff-session-name"
              autoComplete="off"
              value={sessionName}
              onChange={setSessionName}
              placeholder="auth-refactor-follow-up…"
              disabled={isProcessing}
            />
          </FormField>

          <FormField label="Working directory">
            <TextInput
              name="handoff-working-directory"
              autoComplete="off"
              value={targetCwd}
              onChange={setTargetCwd}
              mono
              disabled={isProcessing}
            />
          </FormField>

          <FormField label="Permission mode">
            <OptionGroup>
              {[
                { value: '', label: 'Inherit Source', desc: 'Preserve the source session permission profile' },
                ...permissionModesForCli(formCliType),
              ].map(mode => (
                <OptionButton
                  key={mode.value}
                  selected={permissionMode === mode.value}
                  disabled={isProcessing}
                  onClick={() => setPermissionMode(mode.value)}
                >
                  {mode.label}
                </OptionButton>
              ))}
            </OptionGroup>
          </FormField>

          {/* Advanced toggle */}
          <button
            type="button"
            className="cc-advanced-toggle"
            aria-expanded={showAdvanced}
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            {showAdvanced ? 'Hide advanced options' : 'Show advanced options'}
          </button>

          {showAdvanced && (
            <>
              <FormField label="Model">
                <SelectInput
                  name="handoff-model"
                  value={model}
                  onChange={setModel}
                  options={modelsForCli(formCliType)}
                  disabled={isProcessing}
                />
              </FormField>
              {formCliType === 'copilot' ? (
                <FormField label="Agent mode">
                  <OptionGroup>
                    {COPILOT_MODES.map(mode => (
                      <OptionButton
                        key={mode.value}
                        selected={copilotMode === mode.value}
                        disabled={isProcessing}
                        onClick={() => setCopilotMode(mode.value)}
                        description={mode.desc}
                      >
                        {mode.label}
                      </OptionButton>
                    ))}
                    <OptionButton
                      selected={copilotMode === ''}
                      disabled={isProcessing}
                      onClick={() => setCopilotMode('')}
                      description="Preserve the source session mode"
                    >
                      Inherit Source
                    </OptionButton>
                  </OptionGroup>
                </FormField>
              ) : null}
              <FormField label="Effort">
                <OptionGroup>
                  {EFFORT_LEVELS.map(level => (
                    <OptionButton
                      key={level.value}
                      selected={effort === level.value}
                      disabled={isProcessing}
                      onClick={() => setEffort(level.value)}
                    >
                      {level.label}
                    </OptionButton>
                  ))}
                </OptionGroup>
              </FormField>
            </>
          )}

          {/* Status */}
          {status !== 'idle' && (
            <div className={`cc-handoff-status cc-handoff-status--${status}`}>
              {isProcessing && (
                <div>
                  <span className="cc-handoff-spinner" aria-hidden="true" />
                  <span>{STATUS_LABELS[status]}</span>
                </div>
              )}
              {status === 'done' && (
                <div>{STATUS_LABELS.done}</div>
              )}
              {status === 'error' && (
                <div>{error || STATUS_LABELS.error}</div>
              )}
            </div>
          )}
        </div>
    </Modal>
  );
}
