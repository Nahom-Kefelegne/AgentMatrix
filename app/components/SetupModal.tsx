'use client';

import { useCallback } from 'react';

const HOOK_CONFIG = `{
  "hooks": {
    "SessionStart": [
      {
        "type": "command",
        "command": "curl -s -X POST http://localhost:3000/api/hooks/session-start -H 'Content-Type: application/json' -d '$CLAUDE_EVENT_DATA'"
      }
    ],
    "SessionEnd": [
      {
        "type": "command",
        "command": "curl -s -X POST http://localhost:3000/api/hooks/session-end -H 'Content-Type: application/json' -d '$CLAUDE_EVENT_DATA'"
      }
    ],
    "ToolUse": [
      {
        "type": "command",
        "command": "curl -s -X POST http://localhost:3000/api/hooks/tool-use -H 'Content-Type: application/json' -d '$CLAUDE_EVENT_DATA'"
      }
    ],
    "ToolResult": [
      {
        "type": "command",
        "command": "curl -s -X POST http://localhost:3000/api/hooks/tool-complete -H 'Content-Type: application/json' -d '$CLAUDE_EVENT_DATA'"
      }
    ],
    "SubagentStart": [
      {
        "type": "command",
        "command": "curl -s -X POST http://localhost:3000/api/hooks/agent-start -H 'Content-Type: application/json' -d '$CLAUDE_EVENT_DATA'"
      }
    ],
    "SubagentEnd": [
      {
        "type": "command",
        "command": "curl -s -X POST http://localhost:3000/api/hooks/agent-stop -H 'Content-Type: application/json' -d '$CLAUDE_EVENT_DATA'"
      }
    ],
    "Stop": [
      {
        "type": "command",
        "command": "curl -s -X POST http://localhost:3000/api/hooks/session-end -H 'Content-Type: application/json' -d '$CLAUDE_EVENT_DATA'"
      }
    ]
  }
}`;

interface SetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  connected: boolean;
  sessionCount: number;
}

export default function SetupModal({ isOpen, onClose, connected, sessionCount }: SetupModalProps) {
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(HOOK_CONFIG);
  }, []);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          zIndex: 59,
        }}
      />
      {/* Modal */}
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 480,
          maxHeight: '80vh',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: 8,
          zIndex: 60,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: '1px solid var(--border-color)',
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 'bold' }}>Setup</span>
          <button
            onClick={onClose}
            style={{
              width: 24,
              height: 24,
              borderRadius: 4,
              border: '1px solid var(--border-color)',
              background: 'var(--bg-tertiary)',
              color: 'var(--text-secondary)',
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            x
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>
          {/* Status */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: connected ? '#51cf66' : '#ff6b6b',
                  display: 'inline-block',
                }}
              />
              <span style={{ fontSize: 12 }}>
                {connected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Active sessions: {sessionCount}
            </div>
          </div>

          {/* Hook config */}
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 8,
              }}
            >
              <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                ~/.claude/settings.json
              </span>
              <button
                onClick={handleCopy}
                style={{
                  padding: '2px 8px',
                  borderRadius: 3,
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-secondary)',
                  fontSize: 10,
                }}
              >
                Copy
              </button>
            </div>
            <pre
              style={{
                background: 'var(--bg-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: 4,
                padding: 12,
                fontSize: 10,
                lineHeight: 1.4,
                overflowX: 'auto',
                whiteSpace: 'pre',
                color: 'var(--text-secondary)',
              }}
            >
              {HOOK_CONFIG}
            </pre>
          </div>
        </div>
      </div>
    </>
  );
}
