'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { usePrompt, type PromptMessage, type ActivityInfo } from '@/lib/hooks/usePrompt';
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

/** Thinking widget — not a message bubble, just a status indicator */
function ThinkingWidget({ activity }: { activity: ActivityInfo | null }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const formatElapsed = (s: number) => {
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  };

  return (
    <div style={{
      padding: '14px 18px',
      borderRadius: 12,
      background: '#12121e',
      border: '1px solid #1e1e30',
      marginBottom: 12,
      maxWidth: 350,
    }}>
      {/* Pulsing dot + "Thinking" + timer */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}>
        <div style={{
          width: 10, height: 10, borderRadius: '50%',
          background: '#4a9eff',
          flexShrink: 0,
        }}>
          <style>{`
            @keyframes promptPulse {
              0%, 100% { opacity: 0.3; transform: scale(0.8); }
              50% { opacity: 1; transform: scale(1.3); }
            }
          `}</style>
          <div style={{
            width: 10, height: 10, borderRadius: '50%',
            background: '#4a9eff',
            animation: 'promptPulse 1.2s ease-in-out infinite',
          }} />
        </div>
        <span style={{ fontSize: 15, color: '#c0c0d8', fontWeight: 600 }}>
          Working
        </span>
        <span style={{ fontSize: 13, color: '#666', marginLeft: 'auto' }}>
          {formatElapsed(elapsed)}
        </span>
      </div>

      {/* Current tool activity */}
      {activity && (
        <div style={{
          marginTop: 10,
          fontSize: 14,
          color: '#8ab4e0',
          padding: '6px 10px',
          background: '#0e1a2e',
          borderRadius: 6,
          fontFamily: "'Courier New', monospace",
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {activity.toolSummary}
        </div>
      )}
    </div>
  );
}

export default function PromptPanel({ sessionId, sessionName, cwd }: PromptPanelProps) {
  const { socketRef } = useSocketContext();
  const { messages, sendPrompt, isWaiting, isReady, activity, clear, setMessages, stopWaiting } = usePrompt(socketRef, sessionId);
  const [input, setInput] = useState('');
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
  }, [messages, isWaiting, activity, scrollToBottom]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || isWaiting) return;
    sendPrompt(trimmed);
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
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

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0,
    }}>
      {/* Messages */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '16px 0', minHeight: 0,
      }}>
        {messages.length === 0 && !isWaiting && (
          <div style={{
            textAlign: 'center', color: '#888', fontSize: 16, marginTop: 60,
          }}>
            Send a prompt to <span style={{ color: '#8ab4e0', fontWeight: 600 }}>{sessionName}</span>
          </div>
        )}
        {messages.map((msg, i) => (
          <MessageBubble key={i} message={msg} />
        ))}
        {isWaiting && <ThinkingWidget activity={activity} />}
        <div ref={messagesEndRef} />
      </div>

      {/* Status */}
      <div style={{
        padding: '8px 0', fontSize: 14, color: '#aaa',
        display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
      }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: isWaiting ? '#4a9eff' : isReady ? '#51cf66' : '#666',
          display: 'inline-block',
          boxShadow: isWaiting ? '0 0 6px #4a9eff60' : isReady ? '0 0 6px #51cf6660' : 'none',
        }} />
        {isWaiting ? 'Working...' : isReady ? 'Ready' : 'Idle'}
        {isWaiting && (
          <button onClick={stopWaiting} style={{
            background: 'none', border: 'none', color: '#ff6b6b',
            fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
          }}>
            Stop
          </button>
        )}
        {messages.length > 0 && (
          <button onClick={clear} style={{
            marginLeft: 'auto', background: 'none', border: 'none',
            color: '#777', fontSize: 13, cursor: 'pointer',
            fontFamily: 'inherit', fontWeight: 600,
          }}>
            Clear
          </button>
        )}
      </div>

      {/* Input */}
      <div style={{
        flexShrink: 0, background: '#0e0e18', borderRadius: 10,
        border: '1px solid #222238', padding: '12px 14px',
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
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: '#eee', fontSize: 16, fontFamily: "'Courier New', monospace",
              resize: 'none', lineHeight: '22px',
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isWaiting}
            style={{
              padding: '8px 18px', borderRadius: 8, border: 'none',
              background: input.trim() && !isWaiting ? '#4a9eff' : '#1e1e30',
              color: input.trim() && !isWaiting ? '#fff' : '#666',
              fontSize: 15, fontWeight: 600,
              cursor: input.trim() && !isWaiting ? 'pointer' : 'default',
              fontFamily: 'inherit', flexShrink: 0, transition: 'all 0.15s',
            }}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
