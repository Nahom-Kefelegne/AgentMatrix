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
      marginBottom: 10,
    }}>
      <div style={{
        maxWidth: '85%',
        padding: '10px 14px',
        borderRadius: isUser ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
        background: isUser ? '#1a2540' : '#12121e',
        border: `1px solid ${isUser ? '#253a5e' : '#1e1e30'}`,
        fontFamily: isUser ? 'inherit' : "'Courier New', monospace",
        fontSize: 14,
        color: isUser ? '#c0d8f0' : '#d0d0e0',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        lineHeight: 1.5,
      }}>
        {message.text}
        <div style={{
          fontSize: 11,
          color: '#666',
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
  const { messages, sendPrompt, isWaiting, isReady, clear } = usePrompt(socketRef, sessionId);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
    const maxHeight = 6 * 20; // ~6 rows
    ta.style.height = Math.min(ta.scrollHeight, maxHeight) + 'px';
  };

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
        padding: '12px 0',
        minHeight: 0,
      }}>
        {messages.length === 0 && (
          <div style={{
            textAlign: 'center',
            color: '#555',
            fontSize: 14,
            marginTop: 40,
          }}>
            Send a prompt to <span style={{ color: '#8ab4e0', fontWeight: 600 }}>{sessionName}</span>
            {cwd && (
              <div style={{
                fontSize: 12,
                color: '#444',
                marginTop: 6,
                fontFamily: "'Courier New', monospace",
              }}>
                {cwd}
              </div>
            )}
          </div>
        )}
        {messages.map((msg, i) => (
          <MessageBubble key={i} message={msg} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Status bar */}
      <div style={{
        padding: '6px 0',
        fontSize: 12,
        color: '#777',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        flexShrink: 0,
      }}>
        <span style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: isWaiting ? '#f0c040' : isReady ? '#51cf66' : '#555',
          display: 'inline-block',
        }} />
        {isWaiting ? 'Waiting for response...' : isReady ? 'Ready' : 'Idle'}
      </div>

      {/* Input area */}
      <div style={{
        flexShrink: 0,
        position: 'relative',
        background: '#0e0e18',
        borderRadius: 8,
        border: '1px solid #1e1e30',
        padding: '10px 12px',
        paddingRight: 70,
      }}>
        {messages.length > 0 && (
          <button
            onClick={clear}
            style={{
              position: 'absolute',
              top: 6,
              right: 6,
              background: 'none',
              border: 'none',
              color: '#555',
              fontSize: 11,
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontWeight: 600,
              padding: '2px 6px',
            }}
          >
            Clear
          </button>
        )}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
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
              color: '#ddd',
              fontSize: 14,
              fontFamily: "'Courier New', monospace",
              resize: 'none',
              lineHeight: '20px',
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isWaiting}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: 'none',
              background: input.trim() && !isWaiting ? '#4a9eff' : '#1e1e30',
              color: input.trim() && !isWaiting ? '#fff' : '#555',
              fontSize: 13,
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
