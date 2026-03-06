'use client';

import { useState, useEffect, useCallback } from 'react';
import type { TaskItem, TaskList } from '@/lib/types';

interface TaskBoardProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string | null;
  sessionName: string;
}

const STATUS_COLUMN_COLORS: Record<string, string> = {
  pending: '#ff6b6b',
  in_progress: '#ffd43b',
  completed: '#51cf66',
};

function TaskCard({
  task,
  onAssign,
}: {
  task: TaskItem;
  onAssign?: (task: TaskItem) => void;
}) {
  return (
    <div
      style={{
        background: 'var(--bg-tertiary)',
        border: '1px solid var(--border-color)',
        borderRadius: 4,
        padding: '8px 10px',
        marginBottom: 6,
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: 'var(--text-primary)',
          marginBottom: 4,
          wordBreak: 'break-word',
        }}
      >
        {task.subject}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {task.owner && (
          <span
            style={{
              fontSize: 9,
              padding: '1px 5px',
              borderRadius: 3,
              background: 'var(--accent)',
              color: '#fff',
            }}
          >
            {task.owner}
          </span>
        )}
        <span
          style={{
            fontSize: 9,
            padding: '1px 5px',
            borderRadius: 3,
            background: STATUS_COLUMN_COLORS[task.status] || '#888',
            color: '#000',
            textTransform: 'uppercase',
          }}
        >
          {task.status.replace('_', ' ')}
        </span>
      </div>
      {onAssign && task.status !== 'completed' && (
        <button
          onClick={() => onAssign(task)}
          style={{
            marginTop: 6,
            fontSize: 10,
            padding: '3px 8px',
            borderRadius: 3,
            border: '1px solid var(--border-color)',
            background: 'var(--bg-secondary)',
            color: 'var(--accent)',
            width: '100%',
          }}
        >
          Assign to agent
        </button>
      )}
    </div>
  );
}

function Column({
  title,
  color,
  tasks,
  onAssign,
}: {
  title: string;
  color: string;
  tasks: TaskItem[];
  onAssign: (task: TaskItem) => void;
}) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div
        style={{
          fontSize: 10,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          marginBottom: 8,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: color,
            display: 'inline-block',
          }}
        />
        {title} ({tasks.length})
      </div>
      <div style={{ maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' }}>
        {tasks.map((t) => (
          <TaskCard key={t.id} task={t} onAssign={onAssign} />
        ))}
        {tasks.length === 0 && (
          <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: 8 }}>
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
    if (isOpen) {
      fetchTasks();
    }
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
    // Spawn an agent with the new task description
    try {
      await fetch('/api/sessions/spawn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: newTaskText.trim(),
          cwd: '/Users/nkefelegne/Desktop/DEV',
        }),
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
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.4)',
          zIndex: 46,
        }}
      />
      {/* Panel */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          maxWidth: 720,
          height: '100vh',
          background: 'var(--bg-secondary)',
          borderRight: '1px solid var(--border-color)',
          zIndex: 47,
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 'bold' }}>Task Board</span>
            {sessionName && (
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                ({sessionName})
              </span>
            )}
          </div>
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

        {/* List selector + New task */}
        <div
          style={{
            padding: '8px 16px',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          {taskLists.length > 0 && (
            <select
              value={selectedListId || ''}
              onChange={(e) => setSelectedListId(e.target.value)}
              style={{
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-color)',
                color: 'var(--text-primary)',
                borderRadius: 4,
                padding: '4px 8px',
                fontSize: 11,
                fontFamily: 'inherit',
              }}
            >
              {taskLists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.id} ({l.tasks.length})
                </option>
              ))}
            </select>
          )}
          <input
            value={newTaskText}
            onChange={(e) => setNewTaskText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleNewTask()}
            placeholder="New task description..."
            style={{
              flex: 1,
              minWidth: 120,
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
              color: 'var(--text-primary)',
              borderRadius: 4,
              padding: '4px 8px',
              fontSize: 11,
              fontFamily: 'inherit',
            }}
          />
          <button
            onClick={handleNewTask}
            style={{
              padding: '4px 12px',
              borderRadius: 4,
              border: '1px solid var(--border-color)',
              background: 'var(--accent)',
              color: '#fff',
              fontSize: 11,
            }}
          >
            Spawn
          </button>
        </div>

        {/* Columns */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            gap: 12,
            padding: 16,
            overflowX: 'auto',
          }}
        >
          {loading ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: 16 }}>
              Loading tasks...
            </div>
          ) : taskLists.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: 16 }}>
              No task lists found. Tasks are stored in ~/.claude/tasks/
            </div>
          ) : (
            <>
              <Column
                title="Pending"
                color={STATUS_COLUMN_COLORS.pending}
                tasks={pending}
                onAssign={handleAssign}
              />
              <Column
                title="In Progress"
                color={STATUS_COLUMN_COLORS.in_progress}
                tasks={inProgress}
                onAssign={handleAssign}
              />
              <Column
                title="Completed"
                color={STATUS_COLUMN_COLORS.completed}
                tasks={completed}
                onAssign={handleAssign}
              />
            </>
          )}
        </div>

        {assigning && (
          <div
            style={{
              position: 'absolute',
              bottom: 16,
              left: 16,
              right: 16,
              background: 'var(--accent)',
              color: '#fff',
              padding: '6px 12px',
              borderRadius: 4,
              fontSize: 11,
              textAlign: 'center',
            }}
          >
            Spawning agent...
          </div>
        )}
      </div>
    </>
  );
}
