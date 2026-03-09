'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSocketContext } from './SocketProvider';

interface AppTask {
  id: string;
  subject: string;
  description: string;
  status: 'pending' | 'assigned' | 'completed';
  assignedTo?: string;
  assignedToName?: string;
  createdAt: number;
  assignedAt?: number;
}

interface TaskBoardProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenSession?: (sessionId: string) => void;
}

const STATUS_COLORS: Record<string, string> = {
  pending: '#ff6b6b',
  assigned: '#ffd43b',
  completed: '#51cf66',
};

export default function TaskBoard({ isOpen, onClose, onOpenSession }: TaskBoardProps) {
  const { socketRef, sessions } = useSocketContext();
  const [tasks, setTasks] = useState<AppTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newSubject, setNewSubject] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [assigningTask, setAssigningTask] = useState<AppTask | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState('');

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/app-tasks');
      const data = await res.json();
      setTasks(data.tasks || []);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    if (isOpen) fetchTasks();
  }, [isOpen, fetchTasks]);

  const handleCreate = async () => {
    if (!newSubject.trim()) return;
    await fetch('/api/app-tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create', subject: newSubject.trim(), description: newDesc.trim() }),
    });
    setNewSubject('');
    setNewDesc('');
    setCreating(false);
    fetchTasks();
  };

  const handleDelete = async (id: string) => {
    await fetch('/api/app-tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id }),
    });
    fetchTasks();
  };

  const handleMarkComplete = async (id: string) => {
    await fetch('/api/app-tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update', id, changes: { status: 'completed' } }),
    });
    fetchTasks();
  };

  const handleUnassign = async (task: AppTask) => {
    const socket = socketRef.current;
    if (socket && task.assignedTo) {
      // Tell the session to delete the TodoWrite task
      const prompt = `Delete the task with subject "${task.subject}". Use whatever task tool is available to you (TaskUpdate, TodoWrite, etc) to set its status to "deleted". Just delete it and stop. Do NOT ask questions.`;
      socket.emit('terminal:input', { sessionId: task.assignedTo, data: prompt + '\r' });
    }
    // Revert app task to pending
    await fetch('/api/app-tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'update',
        id: task.id,
        changes: { status: 'pending', assignedTo: null, assignedToName: null, assignedAt: null },
      }),
    });
    fetchTasks();
  };

  const handleAssign = async () => {
    if (!assigningTask || !selectedSessionId) return;
    const socket = socketRef.current;
    if (!socket) return;

    const sessionData = sessions.get(selectedSessionId);
    const prompt = `Create a task with subject "${assigningTask.subject}"${assigningTask.description ? ` and description "${assigningTask.description}"` : ''} with status "pending". Use whatever task tool is available to you (TaskCreate, TodoWrite, etc). Do NOT work on the task. Do NOT ask questions. Just create the task and stop.`;

    // Send as stdin to the session
    socket.emit('terminal:input', { sessionId: selectedSessionId, data: prompt + '\r' });

    // Update app task status
    await fetch('/api/app-tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'update',
        id: assigningTask.id,
        changes: { status: 'assigned', assignedTo: selectedSessionId, assignedToName: sessionData?.name || selectedSessionId.slice(0, 8), assignedAt: Date.now() },
      }),
    });

    setAssigningTask(null);
    fetchTasks();

    // Close task board and open the session's console
    if (onOpenSession) {
      onClose();
      // Small delay so close animation finishes before dialog opens
      setTimeout(() => onOpenSession(selectedSessionId), 150);
    }
  };

  const sessionList = Array.from(sessions.values());
  const pending = tasks.filter(t => t.status === 'pending');
  const assigned = tasks.filter(t => t.status === 'assigned');
  const completed = tasks.filter(t => t.status === 'completed');

  if (!isOpen) return null;

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 46 }} />
      <div style={{
        position: 'fixed', top: 'var(--header-height)', right: 0, width: 600,
        height: 'calc(100vh - var(--header-height))', background: '#111118', borderLeft: '1px solid #222235',
        zIndex: 47, display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid #1e1e30',
        }}>
          <span style={{ fontSize: 20, fontWeight: 700, color: '#eee' }}>Task Board</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setCreating(true)} style={{
              padding: '6px 14px', borderRadius: 6, border: 'none',
              background: '#4a9eff', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}>+ New Task</button>
            <button onClick={fetchTasks} style={{
              padding: '6px 14px', borderRadius: 6, border: '1px solid #2a2a3e',
              background: '#1a1a2a', color: '#aaa', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}>Refresh</button>
            <button onClick={onClose} style={{
              width: 28, height: 28, borderRadius: 6, border: '1px solid #2a2a3e',
              background: '#1a1a2a', color: '#888', fontSize: 14,
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            }}>X</button>
          </div>
        </div>

        {/* Create form */}
        {creating && (
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #1e1e30' }}>
            <input
              value={newSubject}
              onChange={e => setNewSubject(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              placeholder="Task name..."
              autoFocus
              style={{
                width: '100%', background: '#1a1a2a', border: '1px solid #2a2a3e',
                color: '#eee', borderRadius: 6, padding: '10px 14px', fontSize: 15,
                fontFamily: 'inherit', marginBottom: 8,
              }}
            />
            <textarea
              value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
              placeholder="Description / instructions (optional)..."
              rows={3}
              style={{
                width: '100%', background: '#1a1a2a', border: '1px solid #2a2a3e',
                color: '#eee', borderRadius: 6, padding: '10px 14px', fontSize: 14,
                fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.4, marginBottom: 8,
              }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setCreating(false)} style={{
                padding: '8px 14px', borderRadius: 6, border: '1px solid #2a2a3e',
                background: '#1a1a2a', color: '#888', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              }}>Cancel</button>
              <button onClick={handleCreate} disabled={!newSubject.trim()} style={{
                padding: '8px 14px', borderRadius: 6, border: 'none',
                background: newSubject.trim() ? '#4a9eff' : '#1e1e30',
                color: newSubject.trim() ? '#fff' : '#555',
                fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              }}>Create</button>
            </div>
          </div>
        )}

        {/* Task list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px' }}>
          {loading ? (
            <div style={{ color: '#888', fontSize: 15, padding: 20, textAlign: 'center' }}>Loading...</div>
          ) : tasks.length === 0 ? (
            <div style={{ color: '#666', fontSize: 15, padding: 40, textAlign: 'center' }}>
              No tasks yet. Click <strong style={{ color: '#4a9eff' }}>+ New Task</strong> to create one.
            </div>
          ) : (
            <>
              {[
                { label: 'Assigned', items: assigned, color: STATUS_COLORS.assigned },
                { label: 'Pending', items: pending, color: STATUS_COLORS.pending },
                { label: 'Completed', items: completed, color: STATUS_COLORS.completed },
              ].filter(g => g.items.length > 0).map(group => (
                <div key={group.label} style={{ marginBottom: 20 }}>
                  <div style={{
                    fontSize: 12, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 1,
                    marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8,
                  }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: group.color }} />
                    {group.label} ({group.items.length})
                  </div>
                  <div style={{ background: '#12121e', borderRadius: 8, border: '1px solid #1e1e30', overflow: 'hidden' }}>
                    {group.items.map((task, i) => (
                      <div key={task.id} style={{
                        padding: '12px 14px',
                        borderBottom: i < group.items.length - 1 ? '1px solid #1a1a28' : 'none',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 15, color: '#eee', fontWeight: 500 }}>{task.subject}</div>
                            {task.description && (
                              <div style={{ fontSize: 13, color: '#888', marginTop: 4, lineHeight: 1.4 }}>
                                {task.description.slice(0, 150)}
                              </div>
                            )}
                            {task.assignedToName && (
                              <span style={{
                                display: 'inline-block', marginTop: 6,
                                fontSize: 11, padding: '2px 8px', borderRadius: 4,
                                background: '#4a9eff20', color: '#7aafff', fontWeight: 600,
                              }}>
                                Assigned to {task.assignedToName}
                              </span>
                            )}
                          </div>
                          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                            {task.status === 'pending' && (
                              <button onClick={() => {
                                setAssigningTask(task);
                                setSelectedSessionId(sessionList[0]?.id || '');
                              }} style={{
                                padding: '4px 10px', borderRadius: 4, border: 'none',
                                background: '#4a9eff', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                              }}>Assign</button>
                            )}
                            {task.status === 'assigned' && (
                              <button onClick={() => handleUnassign(task)} style={{
                                padding: '4px 10px', borderRadius: 4, border: '1px solid #ffd43b40',
                                background: 'transparent', color: '#ffd43b', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                              }}>Unassign</button>
                            )}
                            {task.status !== 'completed' && (
                              <button onClick={() => handleMarkComplete(task.id)} style={{
                                padding: '4px 10px', borderRadius: 4, border: '1px solid #51cf6640',
                                background: 'transparent', color: '#51cf66', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                              }}>Done</button>
                            )}
                            <button onClick={() => handleDelete(task.id)} style={{
                              padding: '4px 10px', borderRadius: 4, border: '1px solid #ff6b6b30',
                              background: 'transparent', color: '#ff6b6b', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                            }}>Del</button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Assign modal */}
      {assigningTask && (
        <>
          <div onClick={() => setAssigningTask(null)} style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100,
          }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            width: 480, background: '#151520', border: '1px solid #2a2a3e', borderRadius: 12,
            zIndex: 101, padding: 20,
          }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#eee', marginBottom: 14 }}>
              Assign Task
            </div>
            <div style={{
              padding: '10px 14px', background: '#12121e', borderRadius: 8, border: '1px solid #1e1e30',
              marginBottom: 14,
            }}>
              <div style={{ fontSize: 15, color: '#eee', fontWeight: 500 }}>{assigningTask.subject}</div>
              {assigningTask.description && (
                <div style={{ fontSize: 13, color: '#888', marginTop: 4 }}>{assigningTask.description.slice(0, 100)}</div>
              )}
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 13, color: '#888', fontWeight: 600, marginBottom: 6 }}>Send to session</div>
              {sessionList.length === 0 ? (
                <div style={{ fontSize: 14, color: '#666', fontStyle: 'italic' }}>No active sessions</div>
              ) : (
                <select
                  value={selectedSessionId}
                  onChange={e => setSelectedSessionId(e.target.value)}
                  style={{
                    width: '100%', background: '#1a1a2a', border: '1px solid #2a2a3e', color: '#eee',
                    borderRadius: 6, padding: '10px 14px', fontSize: 15, fontFamily: 'inherit',
                  }}
                >
                  {sessionList.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              )}
            </div>
            <div style={{ fontSize: 13, color: '#666', marginBottom: 14 }}>
              The task will be sent as a prompt to the session, instructing it to create a TodoWrite task and work on it.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setAssigningTask(null)} style={{
                padding: '8px 16px', borderRadius: 6, border: '1px solid #2a2a3e',
                background: '#1a1a2a', color: '#888', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              }}>Cancel</button>
              <button onClick={handleAssign} disabled={!selectedSessionId} style={{
                padding: '8px 16px', borderRadius: 6, border: 'none',
                background: selectedSessionId ? '#4a9eff' : '#1e1e30',
                color: selectedSessionId ? '#fff' : '#555',
                fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              }}>Assign</button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
