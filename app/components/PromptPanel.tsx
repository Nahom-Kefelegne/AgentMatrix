'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { usePrompt, type PromptMessage } from '@/lib/hooks/usePrompt';
import { useSocketContext } from './SocketProvider';

interface PromptPanelProps {
  sessionId: string;
  sessionName: string;
  cwd?: string;
}

function formatRelativeTime(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

function MessageBubble({ message }: { message: PromptMessage }) {
  const isUser = message.role === 'user';
  return (
    <div style={{
      display: 'flex',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      marginBottom: 12,
    }}>
      <div style={{
        maxWidth: '85%',
        padding: '12px 16px',
        borderRadius: isUser ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
        background: isUser ? '#1a2540' : '#161625',
        border: `1px solid ${isUser ? '#253a5e' : '#222238'}`,
        fontFamily: isUser ? 'inherit' : "'Courier New', monospace",
        fontSize: 15,
        color: isUser ? '#d0e0f8' : '#e0e0e8',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        lineHeight: 1.6,
      }}>
        {message.text}
        <div style={{
          fontSize: 12,
          color: '#777',
          marginTop: 6,
          textAlign: isUser ? 'right' : 'left',
        }}>
          {formatRelativeTime(message.timestamp)}
        </div>
      </div>
    </div>
  );
}

export default function PromptPanel({ sessionId, sessionName, cwd }: PromptPanelProps) {
  const { socketRef } = useSocketContext();
  const { messages, sendPrompt, isWaiting, isReady, clear, setMessages } = usePrompt(socketRef, sessionId);
  const [input, setInput] = useState('');
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [needsConsent, setNeedsConsent] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Listen for consent-needed events
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    const handleConsent = (data: { sessionId: string }) => {
      if (data.sessionId === sessionId) setNeedsConsent(true);
    };
    socket.on('terminal:consent' as any, handleConsent);
    return () => { socket.off('terminal:consent' as any, handleConsent); };
  }, [socketRef, sessionId]);

  // Load session history on first mount
  useEffect(() => {
    if (historyLoaded) return;
    setHistoryLoaded(true);
    fetch(`/api/sessions/history?sessionId=${sessionId}&count=6`)
      .then(r => r.json())
      .then(data => {
        if (data.messages?.length && messages.length === 0) {
          setMessages(data.messages.map((m: { role: string; text: string; timestamp?: string }) => ({
            role: m.role as 'user' | 'assistant',
            text: m.text,
            timestamp: m.timestamp ? new Date(m.timestamp).getTime() : Date.now(),
          })));
        }
      })
      .catch(() => {});
  }, [sessionId, historyLoaded, messages.length, setMessages]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || isWaiting) return;
    sendPrompt(trimmed);
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [input, isWaiting, sendPrompt]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
  };

  // Show warning if Claude hasn't been initialized
  if (!isReady && messages.length === 0) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', height: '100%',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          textAlign: 'center', maxWidth: 420, padding: '0 20px',
        }}>
          {needsConsent ? (
            <>
              <div style={{ fontSize: 32, marginBottom: 16 }}>&#9888;</div>
              <div style={{ fontSize: 18, color: '#f0c040', fontWeight: 700, marginBottom: 12 }}>
                Consent Required
              </div>
              <div style={{
                fontSize: 15, color: '#bbb', lineHeight: 1.6,
                padding: '14px 20px', background: '#1a1a10', borderRadius: 8,
                border: '1px solid #3a3a20',
              }}>
                This session needs permission to access the project directory. Go to the <strong style={{ color: '#4a9eff' }}>Console</strong> tab and accept the trust prompt, then come back here.
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 28, marginBottom: 16, opacity: 0.4 }}>&#9654;</div>
              <div style={{ fontSize: 16, color: '#aaa', marginBottom: 12 }}>
                Session not initialized yet
              </div>
              <div style={{
                fontSize: 14, color: '#777', lineHeight: 1.6,
                padding: '14px 20px', background: '#12121e', borderRadius: 8,
              }}>
                Open the <strong style={{ color: '#4a9eff' }}>Console</strong> tab to start a terminal session, then come back here for a chat-style interface.
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      minHeight: 0,
    }}>
      {/* Messages area */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '16px 0',
        minHeight: 0,
      }}>
        {messages.length === 0 && (
          <div style={{
            textAlign: 'center',
            color: '#888',
            fontSize: 16,
            marginTop: 60,
          }}>
            Send a prompt to <span style={{ color: '#8ab4e0', fontWeight: 600 }}>{sessionName}</span>
          </div>
        )}
        {messages.map((msg, i) => (
          <MessageBubble key={i} message={msg} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Status bar */}
      <div style={{
        padding: '8px 0',
        fontSize: 14,
        color: '#aaa',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexShrink: 0,
      }}>
        <span style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: isWaiting ? '#f0c040' : isReady ? '#51cf66' : '#666',
          display: 'inline-block',
          boxShadow: isWaiting ? '0 0 6px #f0c04060' : isReady ? '0 0 6px #51cf6660' : 'none',
        }} />
        {isWaiting ? 'Waiting for response...' : isReady ? 'Ready' : 'Idle'}
        {messages.length > 0 && (
          <button
            onClick={clear}
            style={{
              marginLeft: 'auto',
              background: 'none', border: 'none',
              color: '#777', fontSize: 13, cursor: 'pointer',
              fontFamily: 'inherit', fontWeight: 600,
            }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Input area */}
      <div style={{
        flexShrink: 0,
        background: '#0e0e18',
        borderRadius: 10,
        border: '1px solid #222238',
        padding: '12px 14px',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Type a prompt..."
            rows={2}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: '#eee',
              fontSize: 16,
              fontFamily: "'Courier New', monospace",
              resize: 'none',
              lineHeight: '22px',
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isWaiting}
            style={{
              padding: '8px 18px',
              borderRadius: 8,
              border: 'none',
              background: input.trim() && !isWaiting ? '#4a9eff' : '#1e1e30',
              color: input.trim() && !isWaiting ? '#fff' : '#666',
              fontSize: 15,
              fontWeight: 600,
              cursor: input.trim() && !isWaiting ? 'pointer' : 'default',
              fontFamily: 'inherit',
              flexShrink: 0,
              transition: 'all 0.15s',
            }}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
