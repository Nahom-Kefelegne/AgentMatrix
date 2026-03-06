'use client';

import { useState, useEffect, useCallback } from 'react';
import type { TaskItem, TaskList } from '@/lib/types';

interface TaskBoardProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string | null;
  sessionName: string;
}

const STATUS_COLORS: Record<string, string> = {
  pending: '#ff6b6b',
  in_progress: '#ffd43b',
  completed: '#51cf66',
};

function TaskCard({ task, onAssign }: { task: TaskItem; onAssign?: (task: TaskItem) => void }) {
  return (
    <div
      style={{
        background: '#1a1a2a',
        border: '1px solid #2a2a3e',
        borderRadius: 8,
        padding: '12px 14px',
        marginBottom: 8,
      }}
    >
      <div style={{ fontSize: 14, color: '#eee', marginBottom: 8, wordBreak: 'break-word', fontWeight: 500 }}>
        {task.subject}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {task.owner && (
          <span style={{
            fontSize: 12, padding: '3px 8px', borderRadius: 4,
            background: '#4a9eff', color: '#fff', fontWeight: 600,
          }}>
            {task.owner}
          </span>
        )}
        <span style={{
          fontSize: 12, padding: '3px 8px', borderRadius: 4,
          background: STATUS_COLORS[task.status] || '#888', color: '#000',
          textTransform: 'uppercase', fontWeight: 600,
        }}>
          {task.status.replace('_', ' ')}
        </span>
      </div>
      {onAssign && task.status !== 'completed' && (
        <button
          onClick={() => onAssign(task)}
          style={{
            marginTop: 10, fontSize: 13, padding: '6px 12px', borderRadius: 6,
            border: '1px solid #3a3a4e', background: '#1e1e30',
            color: '#7aafff', width: '100%', fontWeight: 600, cursor: 'pointer',
          }}
        >
          Assign to agent
        </button>
      )}
    </div>
  );
}

function Column({ title, color, tasks, onAssign }: {
  title: string; color: string; tasks: TaskItem[]; onAssign: (task: TaskItem) => void;
}) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{
        fontSize: 13, color: '#9a9ab0', textTransform: 'uppercase', letterSpacing: 1,
        marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600,
      }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />
        {title} ({tasks.length})
      </div>
      <div style={{ maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}>
        {tasks.map((t) => (
          <TaskCard key={t.id} task={t} onAssign={onAssign} />
        ))}
        {tasks.length === 0 && (
          <div style={{ fontSize: 14, color: '#555', padding: 12, fontStyle: 'italic' }}>
            No tasks
          </div>
        )}
      </div>
    </div>
  );
}

export default function TaskBoard({ isOpen, onClose, sessionName }: TaskBoardProps) {
  const [taskLists, setTaskLists] = useState<TaskList[]>([]);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [newTaskText, setNewTaskText] = useState('');
  const [assigning, setAssigning] = useState(false);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/tasks');
      const data = await res.json();
      setTaskLists(data.taskLists || []);
      if (data.taskLists?.length > 0 && !selectedListId) {
        setSelectedListId(data.taskLists[0].id);
      }
    } catch (err) {
      console.error('Failed to fetch tasks:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedListId]);

  useEffect(() => {
    if (isOpen) fetchTasks();
  }, [isOpen, fetchTasks]);

  const handleAssign = useCallback(async (task: TaskItem) => {
    setAssigning(true);
    try {
      await fetch('/api/sessions/spawn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: task.subject + (task.description ? ': ' + task.description : ''),
          cwd: '/Users/nkefelegne/Desktop/DEV',
        }),
      });
    } catch (err) {
      console.error('Failed to spawn session:', err);
    } finally {
      setAssigning(false);
    }
  }, []);

  const handleNewTask = useCallback(async () => {
    if (!newTaskText.trim()) return;
    try {
      await fetch('/api/sessions/spawn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: newTaskText.trim(), cwd: '/Users/nkefelegne/Desktop/DEV' }),
      });
      setNewTaskText('');
    } catch (err) {
      console.error('Failed to create task:', err);
    }
  }, [newTaskText]);

  const selectedList = taskLists.find((l) => l.id === selectedListId);
  const pending = selectedList?.tasks.filter((t) => t.status === 'pending') || [];
  const inProgress = selectedList?.tasks.filter((t) => t.status === 'in_progress') || [];
  const completed = selectedList?.tasks.filter((t) => t.status === 'completed') || [];

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 46 }} />
      {/* Panel */}
      <div style={{
        position: 'fixed', top: 0, left: 0, width: '100vw', maxWidth: 800,
        height: '100vh', background: '#151520', borderRight: '1px solid #2a2a3e',
        zIndex: 47, display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid #2a2a3e',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20, fontWeight: 700, color: '#eee' }}>Task Board</span>
            {sessionName && (
              <span style={{ fontSize: 14, color: '#888' }}>({sessionName})</span>
            )}
          </div>
          <button onClick={onClose} style={{
            width: 32, height: 32, borderRadius: 6, border: '1px solid #3a3a4e',
            background: '#1e1e30', color: '#aaa', fontSize: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          }}>
            ✕
          </button>
        </div>

        {/* List selector + New task */}
        <div style={{
          padding: '12px 20px', borderBottom: '1px solid #2a2a3e',
          display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
        }}>
          {taskLists.length > 0 && (
            <select
              value={selectedListId || ''}
              onChange={(e) => setSelectedListId(e.target.value)}
              style={{
                background: '#1a1a2a', border: '1px solid #2a2a3e', color: '#eee',
                borderRadius: 6, padding: '8px 12px', fontSize: 14, fontFamily: 'inherit',
              }}
            >
              {taskLists.map((l) => (
                <option key={l.id} value={l.id}>{l.name} ({l.tasks.length})</option>
              ))}
            </select>
          )}
          <input
            value={newTaskText}
            onChange={(e) => setNewTaskText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleNewTask()}
            placeholder="New task description..."
            style={{
              flex: 1, minWidth: 150, background: '#1a1a2a', border: '1px solid #2a2a3e',
              color: '#eee', borderRadius: 6, padding: '8px 12px', fontSize: 14, fontFamily: 'inherit',
            }}
          />
          <button onClick={handleNewTask} style={{
            padding: '8px 16px', borderRadius: 6, border: 'none',
            background: '#4a9eff', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}>
            Spawn
          </button>
        </div>

        {/* Columns */}
        <div style={{ flex: 1, display: 'flex', gap: 16, padding: 20, overflowX: 'auto' }}>
          {loading ? (
            <div style={{ color: '#888', fontSize: 16, padding: 20 }}>Loading tasks...</div>
          ) : taskLists.length === 0 ? (
            <div style={{ color: '#888', fontSize: 16, padding: 20 }}>
              No task lists found. Tasks are stored in ~/.claude/tasks/
            </div>
          ) : (
            <>
              <Column title="Pending" color={STATUS_COLORS.pending} tasks={pending} onAssign={handleAssign} />
              <Column title="In Progress" color={STATUS_COLORS.in_progress} tasks={inProgress} onAssign={handleAssign} />
              <Column title="Completed" color={STATUS_COLORS.completed} tasks={completed} onAssign={handleAssign} />
            </>
          )}
        </div>

        {assigning && (
          <div style={{
            position: 'absolute', bottom: 20, left: 20, right: 20,
            background: '#4a9eff', color: '#fff', padding: '10px 16px',
            borderRadius: 8, fontSize: 14, textAlign: 'center', fontWeight: 600,
          }}>
            Spawning agent...
          </div>
        )}
      </div>
    </>
  );
}
