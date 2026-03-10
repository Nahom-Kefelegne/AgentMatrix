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

function TaskCard({ task, onAssign, onEdit }: {
  task: TaskItem;
  onAssign?: (task: TaskItem) => void;
  onEdit?: (task: TaskItem) => void;
}) {
  return (
    <div style={{
      background: '#1e1e30', border: '1px solid #33334a', borderRadius: 8,
      padding: '12px 14px', marginBottom: 8,
    }}>
      <div style={{ fontSize: 14, color: '#eee', marginBottom: 8, wordBreak: 'break-word', fontWeight: 500 }}>
        {task.subject}
      </div>
      {task.description && task.description !== task.subject && (
        <div style={{ fontSize: 13, color: '#888', marginBottom: 8, wordBreak: 'break-word' }}>
          {task.description.slice(0, 120)}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
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
      <div style={{ display: 'flex', gap: 8 }}>
        {onEdit && (
          <button
            onClick={() => onEdit(task)}
            style={{
              flex: 1, fontSize: 13, padding: '6px 12px', borderRadius: 6,
              border: '1px solid #3a3a4e', background: '#1e1e30',
              color: '#aaa', fontWeight: 600, cursor: 'pointer',
            }}
          >
            Edit
          </button>
        )}
        {onAssign && task.status !== 'completed' && (
          <button
            onClick={() => onAssign(task)}
            style={{
              flex: 1, fontSize: 13, padding: '6px 12px', borderRadius: 6,
              border: '1px solid #3a3a4e', background: '#1e1e30',
              color: '#7aafff', fontWeight: 600, cursor: 'pointer',
            }}
          >
            Assign
          </button>
        )}
      </div>
    </div>
  );
}

/** Folder browser component */
function FolderPicker({ value, onChange }: { value: string; onChange: (path: string) => void }) {
  const [dirs, setDirs] = useState<{ name: string; path: string }[]>([]);
  const [open, setOpen] = useState(false);

  const loadDirs = useCallback(async (parentPath: string) => {
    try {
      const res = await fetch(`/api/dirs?path=${encodeURIComponent(parentPath)}`);
      const data = await res.json();
      setDirs(data.dirs || []);
    } catch {
      setDirs([]);
    }
  }, []);

  useEffect(() => {
    if (open) loadDirs(value);
  }, [open, value, loadDirs]);

  const goUp = () => {
    const parent = value.split('/').slice(0, -1).join('/') || '/';
    onChange(parent);
    loadDirs(parent);
  };

  return (
    <div style={{ position: 'relative' }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          width: '100%', background: '#1a1a2a', border: '1px solid #2a2a3e',
          color: '#eee', borderRadius: 6, padding: '8px 12px', fontSize: 14,
          fontFamily: 'inherit', cursor: 'pointer', display: 'flex',
          justifyContent: 'space-between', alignItems: 'center',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
        <span style={{ color: '#888', fontSize: 12 }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div style={{
          position: 'absolute', bottom: '100%', left: 0, right: 0, zIndex: 110,
          background: '#1a1a2a', border: '1px solid #2a2a3e', borderRadius: 6,
          marginBottom: 4, maxHeight: 250, overflowY: 'auto',
        }}>
          <div
            onClick={goUp}
            style={{
              padding: '8px 12px', fontSize: 14, color: '#7aafff', cursor: 'pointer',
              borderBottom: '1px solid #222235',
            }}
          >
            <span>↑</span>{' '}<span>Parent Directory</span>
          </div>
          {dirs.map(d => (
            <div
              key={d.path}
              onClick={() => { onChange(d.path); loadDirs(d.path); }}
              style={{
                padding: '8px 12px', fontSize: 14, color: '#c8c8d8', cursor: 'pointer',
                borderBottom: '1px solid #222235',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#222235')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              📁 {d.name}
            </div>
          ))}
          {dirs.length === 0 && (
            <div style={{ padding: '8px 12px', fontSize: 13, color: '#555', fontStyle: 'italic' }}>
              No subdirectories
            </div>
          )}
          <div
            onClick={() => setOpen(false)}
            style={{
              padding: '8px 12px', fontSize: 13, color: '#51cf66', cursor: 'pointer',
              borderTop: '1px solid #2a2a3e', fontWeight: 600, textAlign: 'center',
            }}
          >
            ✓ Select this folder
          </div>
        </div>
      )}
    </div>
  );
}

/** Modal that appears when assigning a task — existing session or new agent */
function AssignModal({ task, onSpawn, onReassign, onCancel }: {
  task: TaskItem;
  onSpawn: (prompt: string, cwd: string, name: string) => void;
  onReassign: (task: TaskItem, sessionName: string) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [sessions, setSessions] = useState<{ id: string; name: string }[]>([]);
  const [selectedSession, setSelectedSession] = useState('');

  useEffect(() => {
    fetch('/api/sessions/active').then(r => r.json()).then(data => {
      setSessions(data.sessions || []);
      if (data.sessions?.length > 0) setSelectedSession(data.sessions[0].name);
    }).catch(() => {});
  }, []);
  const defaultPrompt = task.subject + (task.description && task.description !== task.subject
    ? '\n\n' + task.description : '');
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [cwd, setCwd] = useState('');
  const [name, setName] = useState(
    task.subject.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30)
  );

  return (
    <>
      <div onClick={onCancel} style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100,
      }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 540, maxHeight: '80vh', background: '#151520', border: '1px solid #2a2a3e', borderRadius: 12,
        zIndex: 101, display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid #2a2a3e',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ fontSize: 18, fontWeight: 700, color: '#eee' }}>Assign Task</span>
          <button onClick={onCancel} style={{
            width: 28, height: 28, borderRadius: 6, border: '1px solid #3a3a4e',
            background: '#1e1e30', color: '#aaa', fontSize: 14,
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          }}>✕</button>
        </div>

        {/* Task preview */}
        <div style={{ padding: '12px 20px', borderBottom: '1px solid #2a2a3e' }}>
          <div style={{ fontSize: 15, color: '#eee', fontWeight: 600 }}>{task.subject}</div>
        </div>

        {/* Mode tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #2a2a3e' }}>
          {(['existing', 'new'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              flex: 1, padding: '12px 0', fontSize: 15, fontWeight: 600, cursor: 'pointer',
              color: mode === m ? '#eee' : '#666', background: 'none',
              borderTop: 'none', borderLeft: 'none', borderRight: 'none',
              borderBottomWidth: 2, borderBottomStyle: 'solid',
              borderBottomColor: mode === m ? '#4a9eff' : 'transparent',
            }}>
              {m === 'existing' ? 'Existing Session' : 'New Agent'}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>
          {mode === 'existing' ? (
            <>
              <div>
                <label style={{ fontSize: 14, color: '#b0b0c8', fontWeight: 600, display: 'block', marginBottom: 6 }}>
                  Assign to Session
                </label>
                {sessions.length === 0 ? (
                  <div style={{ fontSize: 14, color: '#777', fontStyle: 'italic', padding: 10 }}>
                    No active sessions found
                  </div>
                ) : (
                  <select
                    value={selectedSession}
                    onChange={(e) => setSelectedSession(e.target.value)}
                    style={{
                      width: '100%', background: '#1e1e30', border: '1px solid #33334a',
                      color: '#eee', borderRadius: 6, padding: '10px 14px', fontSize: 15, fontFamily: 'inherit',
                    }}
                  >
                    {sessions.map(s => (
                      <option key={s.id} value={s.name}>{s.name}</option>
                    ))}
                  </select>
                )}
              </div>
              <div style={{ fontSize: 13, color: '#888' }}>
                The task will be assigned to this session. If the session uses TaskList, it will pick up the task automatically.
              </div>
            </>
          ) : (
            <>
              <div>
                <label style={{ fontSize: 14, color: '#b0b0c8', fontWeight: 600, display: 'block', marginBottom: 6 }}>
                  Session Name
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={{
                    width: '100%', background: '#1e1e30', border: '1px solid #33334a',
                    color: '#eee', borderRadius: 6, padding: '10px 14px', fontSize: 15, fontFamily: 'inherit',
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: 14, color: '#b0b0c8', fontWeight: 600, display: 'block', marginBottom: 6 }}>
                  Instructions for Agent
                </label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={5}
                  style={{
                    width: '100%', background: '#1e1e30', border: '1px solid #33334a',
                    color: '#eee', borderRadius: 6, padding: '10px 14px', fontSize: 14,
                    fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.5,
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: 14, color: '#b0b0c8', fontWeight: 600, display: 'block', marginBottom: 6 }}>
                  Working Directory
                </label>
                <FolderPicker value={cwd} onChange={setCwd} />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 20px', borderTop: '1px solid #2a2a3e',
          display: 'flex', justifyContent: 'flex-end', gap: 10,
        }}>
          <button onClick={onCancel} style={{
            padding: '8px 16px', borderRadius: 6, border: '1px solid #3a3a4e',
            background: '#1e1e30', color: '#aaa', fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}>
            Cancel
          </button>
          {mode === 'existing' ? (
            <button
              onClick={() => selectedSession && onReassign(task, selectedSession)}
              disabled={!selectedSession}
              style={{
                padding: '8px 20px', borderRadius: 6, border: 'none',
                background: '#51cf66', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                opacity: selectedSession ? 1 : 0.5,
              }}
            >
              Assign
            </button>
          ) : (
            <button onClick={() => onSpawn(prompt, cwd, name)} style={{
              padding: '8px 20px', borderRadius: 6, border: 'none',
              background: '#4a9eff', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer',
            }}>
              Spawn Agent
            </button>
          )}
        </div>
      </div>
    </>
  );
}

/** Modal for creating or editing a task */
function TaskFormModal({ task, onSave, onCancel, title: modalTitle }: {
  task?: TaskItem;
  onSave: (subject: string, description: string, status: string) => void;
  onCancel: () => void;
  title: string;
}) {
  const [subject, setSubject] = useState(task?.subject || '');
  const [description, setDescription] = useState(task?.description || '');
  const [status, setStatus] = useState(task?.status || 'pending');

  return (
    <>
      <div onClick={onCancel} style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100,
      }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 480, background: '#151520', border: '1px solid #2a2a3e', borderRadius: 12,
        zIndex: 101, display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid #2a2a3e',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ fontSize: 18, fontWeight: 700, color: '#eee' }}>{modalTitle}</span>
          <button onClick={onCancel} style={{
            width: 28, height: 28, borderRadius: 6, border: '1px solid #3a3a4e',
            background: '#1e1e30', color: '#aaa', fontSize: 14,
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          }}>✕</button>
        </div>
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontSize: 13, color: '#9a9ab0', fontWeight: 600, display: 'block', marginBottom: 4 }}>
              Subject
            </label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Task subject..."
              style={{
                width: '100%', background: '#1a1a2a', border: '1px solid #2a2a3e',
                color: '#eee', borderRadius: 6, padding: '8px 12px', fontSize: 14, fontFamily: 'inherit',
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: 13, color: '#9a9ab0', fontWeight: 600, display: 'block', marginBottom: 4 }}>
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="Detailed description..."
              style={{
                width: '100%', background: '#1a1a2a', border: '1px solid #2a2a3e',
                color: '#eee', borderRadius: 6, padding: '10px 12px', fontSize: 14,
                fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.5,
              }}
            />
          </div>
          {task && (
            <div>
              <label style={{ fontSize: 13, color: '#9a9ab0', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as 'pending' | 'in_progress' | 'completed' | 'deleted')}
                style={{
                  width: '100%', background: '#1a1a2a', border: '1px solid #2a2a3e',
                  color: '#eee', borderRadius: 6, padding: '8px 12px', fontSize: 14, fontFamily: 'inherit',
                }}
              >
                <option value="pending">Pending</option>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
              </select>
            </div>
          )}
        </div>
        <div style={{
          padding: '12px 20px', borderTop: '1px solid #2a2a3e',
          display: 'flex', justifyContent: 'flex-end', gap: 10,
        }}>
          <button onClick={onCancel} style={{
            padding: '8px 16px', borderRadius: 6, border: '1px solid #3a3a4e',
            background: '#1e1e30', color: '#aaa', fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}>Cancel</button>
          <button onClick={() => onSave(subject, description, status)} style={{
            padding: '8px 20px', borderRadius: 6, border: 'none',
            background: '#4a9eff', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}>Save</button>
        </div>
      </div>
    </>
  );
}

/** Modal to reassign a task to an existing active session */
function ReassignModal({ task, onReassign, onCancel }: {
  task: TaskItem;
  onReassign: (task: TaskItem, sessionName: string) => void;
  onCancel: () => void;
}) {
  const [sessions, setSessions] = useState<{ id: string; name: string }[]>([]);
  const [selected, setSelected] = useState('');

  useEffect(() => {
    // Fetch active sessions from the socket state via a simple API
    fetch('/api/sessions/active').then(r => r.json()).then(data => {
      setSessions(data.sessions || []);
      if (data.sessions?.length > 0) setSelected(data.sessions[0].name);
    }).catch(() => {});
  }, []);

  return (
    <>
      <div onClick={onCancel} style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100,
      }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 460, background: '#151520', border: '1px solid #2a2a3e', borderRadius: 12,
        zIndex: 101, display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid #2a2a3e',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ fontSize: 18, fontWeight: 700, color: '#eee' }}>Reassign Task</span>
          <button onClick={onCancel} style={{
            width: 28, height: 28, borderRadius: 6, border: '1px solid #3a3a4e',
            background: '#1e1e30', color: '#aaa', fontSize: 14,
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          }}>✕</button>
        </div>
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontSize: 14, color: '#b0b0c8', fontWeight: 600, display: 'block', marginBottom: 6 }}>
              Task
            </label>
            <div style={{
              fontSize: 15, color: '#eee', padding: '8px 12px',
              background: '#1e1e30', border: '1px solid #33334a', borderRadius: 6,
            }}>
              {task.subject}
            </div>
          </div>
          <div>
            <label style={{ fontSize: 14, color: '#b0b0c8', fontWeight: 600, display: 'block', marginBottom: 6 }}>
              Assign to Session
            </label>
            {sessions.length === 0 ? (
              <div style={{ fontSize: 14, color: '#777', fontStyle: 'italic' }}>No active sessions</div>
            ) : (
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                style={{
                  width: '100%', background: '#1e1e30', border: '1px solid #33334a',
                  color: '#eee', borderRadius: 6, padding: '10px 14px', fontSize: 15, fontFamily: 'inherit',
                }}
              >
                {sessions.map(s => (
                  <option key={s.id} value={s.name}>{s.name}</option>
                ))}
              </select>
            )}
          </div>
        </div>
        <div style={{
          padding: '12px 20px', borderTop: '1px solid #2a2a3e',
          display: 'flex', justifyContent: 'flex-end', gap: 10,
        }}>
          <button onClick={onCancel} style={{
            padding: '8px 16px', borderRadius: 6, border: '1px solid #3a3a4e',
            background: '#1e1e30', color: '#aaa', fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}>Cancel</button>
          <button
            onClick={() => selected && onReassign(task, selected)}
            disabled={!selected}
            style={{
              padding: '8px 20px', borderRadius: 6, border: 'none',
              background: '#51cf66', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer',
              opacity: selected ? 1 : 0.5,
            }}
          >Reassign</button>
        </div>
      </div>
    </>
  );
}

function Column({ title, color, tasks, onAssign, onEdit }: {
  title: string; color: string; tasks: TaskItem[];
  onAssign: (task: TaskItem) => void;
  onEdit: (task: TaskItem) => void;
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
          <TaskCard key={t.id} task={t} onAssign={onAssign} onEdit={onEdit} />
        ))}
        {tasks.length === 0 && (
          <div style={{ fontSize: 14, color: '#555', padding: 12, fontStyle: 'italic' }}>No tasks</div>
        )}
      </div>
    </div>
  );
}

export default function TaskBoard({ isOpen, onClose, sessionName }: TaskBoardProps) {
  const [taskLists, setTaskLists] = useState<TaskList[]>([]);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [assigningTask, setAssigningTask] = useState<TaskItem | null>(null);
  const [editingTask, setEditingTask] = useState<TaskItem | null>(null);
  const [creatingTask, setCreatingTask] = useState(false);
  const [spawning, setSpawning] = useState(false);

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

  const handleSpawn = useCallback(async (prompt: string, cwd: string, name: string) => {
    setSpawning(true);
    try {
      await fetch('/api/sessions/spawn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: prompt, cwd, name }),
      });
      setAssigningTask(null);
    } catch (err) {
      console.error('Failed to spawn session:', err);
    } finally {
      setSpawning(false);
    }
  }, []);

  const handleCreateSave = useCallback(async (subject: string, description: string) => {
    if (!subject.trim() || !selectedListId) return;
    try {
      await fetch('/api/tasks/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listId: selectedListId, subject, description }),
      });
      setCreatingTask(false);
      fetchTasks();
    } catch (err) {
      console.error('Failed to create task:', err);
    }
  }, [selectedListId, fetchTasks]);

  const handleEditSave = useCallback(async (subject: string, description: string, status: string) => {
    if (!editingTask || !selectedListId) return;
    try {
      await fetch('/api/tasks/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listId: selectedListId,
          taskId: editingTask.id,
          changes: { subject, description, status },
        }),
      });
      setEditingTask(null);
      fetchTasks();
    } catch (err) {
      console.error('Failed to update task:', err);
    }
  }, [editingTask, selectedListId, fetchTasks]);

  const handleReassign = useCallback(async (task: TaskItem, sessionName: string) => {
    if (!selectedListId) return;
    try {
      await fetch('/api/tasks/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listId: selectedListId,
          taskId: task.id,
          changes: { owner: sessionName, status: 'in_progress' },
        }),
      });
      setAssigningTask(null);
      fetchTasks();
    } catch (err) {
      console.error('Failed to reassign task:', err);
    }
  }, [selectedListId, fetchTasks]);

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
        position: 'fixed', top: 'var(--header-height)', left: 0, width: '100vw', maxWidth: 800,
        height: 'calc(100vh - var(--header-height))', background: '#151520', borderRight: '1px solid #2a2a3e',
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
          <button onClick={() => setCreatingTask(true)} style={{
            padding: '8px 16px', borderRadius: 6, border: 'none',
            background: '#4a9eff', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}>
            + Add Task
          </button>
          <button onClick={() => fetchTasks()} style={{
            padding: '8px 16px', borderRadius: 6, border: '1px solid #3a3a4e',
            background: '#1e1e30', color: '#aaa', fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}>
            ↻ Refresh
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
              <Column title="Pending" color={STATUS_COLORS.pending} tasks={pending} onAssign={setAssigningTask} onEdit={setEditingTask} />
              <Column title="In Progress" color={STATUS_COLORS.in_progress} tasks={inProgress} onAssign={setAssigningTask} onEdit={setEditingTask} />
              <Column title="Completed" color={STATUS_COLORS.completed} tasks={completed} onAssign={setAssigningTask} onEdit={setEditingTask} />
            </>
          )}
        </div>

        {spawning && (
          <div style={{
            position: 'absolute', bottom: 20, left: 20, right: 20,
            background: '#4a9eff', color: '#fff', padding: '10px 16px',
            borderRadius: 8, fontSize: 14, textAlign: 'center', fontWeight: 600,
          }}>
            Spawning agent...
          </div>
        )}
      </div>

      {/* Assign modal */}
      {assigningTask && (
        <AssignModal
          task={assigningTask}
          onSpawn={handleSpawn}
          onReassign={handleReassign}
          onCancel={() => setAssigningTask(null)}
        />
      )}

      {/* Create task modal */}
      {creatingTask && (
        <TaskFormModal
          title="Create Task"
          onSave={(subject, description) => handleCreateSave(subject, description)}
          onCancel={() => setCreatingTask(false)}
        />
      )}

      {/* Edit task modal */}
      {editingTask && (
        <TaskFormModal
          title="Edit Task"
          task={editingTask}
          onSave={handleEditSave}
          onCancel={() => setEditingTask(null)}
        />
      )}

    </>
  );
}
