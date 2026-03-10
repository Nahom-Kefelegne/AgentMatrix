'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSocketContext } from './SocketProvider';

interface Discussion {
  author: string;
  text: string;
  timestamp: number;
}

interface AppTask {
  id: string;
  subject: string;
  description: string;
  status: 'pending' | 'assigned' | 'completed';
  state?: string; // ADO-style state: Proposed, Active, Resolved, Closed
  source: 'app' | 'ado';
  adoId?: number;
  adoState?: string;
  type?: string;
  priority?: string;
  discussions: Discussion[];
  assignedTo?: string;
  assignedToName?: string;
  createdAt: number;
  assignedAt?: number;
}

interface AdoTask {
  adoId: number;
  title: string;
  state: string;
  type: string;
  priority: string;
  description: string;
}

interface AdoConfig {
  organization: string;
  project: string;
  configured: boolean;
}

interface TaskBoardProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenSession?: (sessionId: string) => void;
  initialTaskId?: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  pending: '#ff6b6b',
  assigned: '#ffd43b',
  completed: '#51cf66',
};

const TASK_STATES = ['Proposed', 'Active', 'Resolved', 'Closed'] as const;
const STATE_COLORS: Record<string, string> = {
  'Proposed': '#4a9eff',
  'New': '#4a9eff',
  'Active': '#ffd43b',
  'Resolved': '#51cf66',
  'Closed': '#888',
  'Committed': '#ffd43b',
  'Done': '#51cf66',
};

const TYPE_ICONS: Record<string, string> = {
  'Bug': '\uD83D\uDD34',
  'Task': '\u2705',
  'User Story': '\uD83D\uDCD6',
  'Feature': '\u2B50',
  'Epic': '\uD83C\uDFD4\uFE0F',
  'Issue': '\u26A0\uFE0F',
  'Test Case': '\uD83E\uDDEA',
};

const TASK_TYPES = ['Bug', 'Task', 'User Story', 'Feature', 'Epic', 'Issue'] as const;

type Tab = 'app' | 'ado';

/** Build ADO work item URL */
function getAdoItemUrl(org: string, project: string, id: number): string {
  let base = org;
  if (!base.startsWith('https://')) {
    base = base.includes('.visualstudio.com') ? `https://${base}` : `https://dev.azure.com/${base}`;
  }
  return `${base.replace(/\/+$/, '')}/${encodeURIComponent(project)}/_workitems/edit/${id}`;
}

// ===== Task Detail Modal =====

function TaskDetailModal({ task, onClose, onUpdate, onComment, onAssign, onDelete, onSync, onSyncClaude, sessions, adoConfig }: {
  task: AppTask;
  onClose: () => void;
  onUpdate: (id: string, changes: Record<string, unknown>) => void;
  onComment: (id: string, text: string) => void;
  onAssign: (task: AppTask) => void;
  onDelete: (id: string) => void;
  onSync: (task: AppTask) => void;
  onSyncClaude?: (task: AppTask) => void;
  sessions: Map<string, { id: string; name: string }>;
  adoConfig?: AdoConfig;
}) {
  const [modalTab, setModalTab] = useState<'details' | 'comments'>('details');
  const [newComment, setNewComment] = useState('');
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState(task.description);
  const [syncing, setSyncing] = useState(false);

  const typeIcon = TYPE_ICONS[task.type || ''] || (task.source === 'ado' ? '\uD83D\uDD35' : '\uD83D\uDCCB');
  const statusColor = STATUS_COLORS[task.status] || '#888';
  const taskState = task.state || task.adoState || 'Proposed';

  const handleStateChange = (newState: string) => {
    // Update local state only — ADO sync happens on "Sync with ADO" button
    onUpdate(task.id, { state: newState, adoState: newState });
  };

  const handleSync = async () => {
    setSyncing(true);
    await onSync(task);
    setSyncing(false);
  };

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100, backdropFilter: 'blur(4px)' }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 720, height: '80vh', background: '#111118', border: '1px solid #222235',
        borderRadius: 16, zIndex: 101, display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      }}>
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #1e1e30', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 22 }}>{typeIcon}</span>
                <span style={{ fontSize: 20, fontWeight: 800, color: '#eee' }}>{task.subject}</span>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 12, background: statusColor + '20', color: statusColor, fontWeight: 700, textTransform: 'uppercase' }}>{task.status}</span>
                <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 12, background: (STATE_COLORS[taskState] || '#888') + '15', color: STATE_COLORS[taskState] || '#888', fontWeight: 700 }}>{taskState}</span>
                {task.source === 'ado' && task.adoId && adoConfig?.configured && (
                  <a href={getAdoItemUrl(adoConfig.organization, adoConfig.project, task.adoId)} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                    style={{ fontSize: 12, padding: '3px 10px', borderRadius: 12, background: '#4a9eff15', color: '#4a9eff', fontWeight: 700, textDecoration: 'none' }}>
                    ADO #{task.adoId} ↗
                  </a>
                )}
                {task.source === 'ado' && task.adoId && !adoConfig?.configured && (
                  <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 12, background: '#4a9eff15', color: '#4a9eff', fontWeight: 700 }}>ADO #{task.adoId}</span>
                )}
                {task.priority && <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 12, background: '#ffd43b15', color: '#ffd43b', fontWeight: 700 }}>P{task.priority}</span>}
                {task.assignedToName && <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 12, background: '#cc5de815', color: '#cc5de8', fontWeight: 700 }}>Assigned: {task.assignedToName}</span>}
              </div>
            </div>
            <button onClick={onClose} style={{ width: 36, height: 36, borderRadius: 8, border: '1px solid #3a3a4e', background: '#1e1e30', color: '#ccc', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>X</button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #1e1e30', padding: '0 24px', flexShrink: 0 }}>
          {(['details', 'comments'] as const).map(t => (
            <button key={t} onClick={() => setModalTab(t)} style={{
              padding: '10px 20px', fontSize: 14, fontWeight: 700, cursor: 'pointer',
              color: modalTab === t ? '#eee' : '#666', background: 'none', border: 'none', fontFamily: 'inherit',
              borderBottom: `2px solid ${modalTab === t ? '#4a9eff' : 'transparent'}`,
              textTransform: 'capitalize',
            }}>{t === 'comments' ? `Comments (${task.discussions?.length || 0})` : t}</button>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          {modalTab === 'details' ? (
            <>
              {/* State changer */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>State</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {TASK_STATES.map(s => (
                    <button key={s} onClick={() => handleStateChange(s)} style={{
                      padding: '6px 14px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                      border: taskState === s ? `2px solid ${STATE_COLORS[s] || '#888'}` : '1px solid #2a2a3e',
                      background: taskState === s ? (STATE_COLORS[s] || '#888') + '15' : '#1a1a2a',
                      color: taskState === s ? STATE_COLORS[s] || '#888' : '#666',
                      cursor: 'pointer', fontFamily: 'inherit',
                    }}>{s}</button>
                  ))}
                </div>
              </div>

              {/* Description */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>Description</span>
                  <button onClick={() => { setEditingDesc(!editingDesc); setDescDraft(task.description); }} style={{ fontSize: 12, color: '#4a9eff', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, fontFamily: 'inherit' }}>
                    {editingDesc ? 'Cancel' : 'Edit'}
                  </button>
                </div>
                {editingDesc ? (
                  <div>
                    <textarea value={descDraft} onChange={e => setDescDraft(e.target.value)} rows={6} style={{ width: '100%', background: '#1a1a2a', border: '1px solid #2a2a3e', color: '#eee', borderRadius: 8, padding: '12px 14px', fontSize: 14, fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.5, marginBottom: 8 }} />
                    <button onClick={() => { onUpdate(task.id, { description: descDraft }); setEditingDesc(false); }} style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: '#4a9eff', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Save</button>
                  </div>
                ) : (
                  <div style={{ fontSize: 14, color: '#bbb', lineHeight: 1.6, background: '#0e0e18', borderRadius: 8, padding: '14px 16px', border: '1px solid #1a1a28', minHeight: 60 }}>
                    {task.description || <span style={{ color: '#555', fontStyle: 'italic' }}>No description</span>}
                  </div>
                )}
              </div>
            </>
          ) : (
            /* Comments tab */
            <>
              {task.discussions?.length > 0 ? (
                task.discussions.map((d, i) => (
                  <div key={i} style={{ padding: '12px 16px', background: '#0e0e18', borderRadius: 10, border: '1px solid #1a1a28', marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontSize: 13, color: '#7aafff', fontWeight: 700 }}>{d.author}</span>
                      <span style={{ fontSize: 11, color: '#555' }}>{new Date(d.timestamp).toLocaleString()}</span>
                    </div>
                    <div style={{ fontSize: 14, color: '#ccc', lineHeight: 1.6, maxHeight: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.text}</div>
                  </div>
                ))
              ) : (
                <div style={{ color: '#555', fontSize: 14, fontStyle: 'italic', padding: '20px 0', textAlign: 'center' }}>No comments yet</div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <input value={newComment} onChange={e => setNewComment(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && newComment.trim()) { onComment(task.id, newComment.trim()); setNewComment(''); } }}
                  placeholder="Add a comment..."
                  style={{ flex: 1, background: '#1a1a2a', border: '1px solid #2a2a3e', color: '#eee', borderRadius: 8, padding: '10px 14px', fontSize: 14, fontFamily: 'inherit' }}
                />
                <button onClick={() => { if (newComment.trim()) { onComment(task.id, newComment.trim()); setNewComment(''); } }} disabled={!newComment.trim()} style={{
                  padding: '10px 16px', borderRadius: 8, border: 'none',
                  background: newComment.trim() ? '#4a9eff' : '#1e1e30', color: newComment.trim() ? '#fff' : '#555',
                  fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                }}>Add</button>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 24px', borderTop: '1px solid #1e1e30', background: '#0e0e16', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {task.status === 'pending' && <button onClick={() => onAssign(task)} style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: '#4a9eff', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Assign to Session</button>}
          {task.status === 'assigned' && task.assignedTo && onSyncClaude && (
            <button onClick={() => onSyncClaude(task)} style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #cc5de840', background: 'transparent', color: '#cc5de8', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
              Sync with Claude
            </button>
          )}
          {task.source === 'ado' && task.adoId && (
            <button onClick={handleSync} disabled={syncing} style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #51cf6640', background: 'transparent', color: '#51cf66', fontSize: 14, fontWeight: 700, cursor: syncing ? 'wait' : 'pointer', fontFamily: 'inherit', opacity: syncing ? 0.6 : 1 }}>
              {syncing ? 'Syncing...' : 'Sync with ADO'}
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button onClick={() => { onDelete(task.id); onClose(); }} style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #ff6b6b30', background: 'transparent', color: '#ff6b6b', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Delete</button>
        </div>
      </div>
    </>
  );
}

// ===== Main TaskBoard =====

export default function TaskBoard({ isOpen, onClose, onOpenSession, initialTaskId }: TaskBoardProps) {
  const { socketRef, sessions } = useSocketContext();
  const [tab, setTab] = useState<Tab>('app');
  const [width, setWidth] = useState(620);
  const dragging = useRef(false);

  // Resize handler
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    const startX = e.clientX;
    const startWidth = width;
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const newWidth = Math.max(400, Math.min(900, startWidth + (startX - ev.clientX)));
      setWidth(newWidth);
    };
    const onUp = () => { dragging.current = false; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [width]);

  // App tasks
  const [tasks, setTasks] = useState<AppTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newSubject, setNewSubject] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newType, setNewType] = useState('Task');
  const [assigningTask, setAssigningTask] = useState<AppTask | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [viewingTask, setViewingTask] = useState<AppTask | null>(null);

  // Search & filter
  const [search, setSearch] = useState('');
  const [filterState, setFilterState] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');

  // ADO
  const [adoConfig, setAdoConfig] = useState<AdoConfig>({ organization: '', project: '', configured: false });
  const [hasAzCli, setHasAzCli] = useState(true);
  const [adoTasks, setAdoTasks] = useState<AdoTask[]>([]);
  const [adoLoading, setAdoLoading] = useState(false);
  const [projects, setProjects] = useState<string[]>([]);
  const [setupOrg, setSetupOrg] = useState('');
  const [setupProject, setSetupProject] = useState('');
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [orgError, setOrgError] = useState('');

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/app-tasks');
      const data = await res.json();
      setTasks(data.tasks || []);
    } catch {}
    setLoading(false);
  }, []);

  // Auto-open task from initialTaskId
  useEffect(() => {
    if (initialTaskId && tasks.length > 0) {
      const task = tasks.find(t => t.id === initialTaskId);
      if (task) setViewingTask(task);
    }
  }, [initialTaskId, tasks]);

  const checkAdo = useCallback(async () => {
    try {
      const res = await fetch('/api/ado?action=check');
      const data = await res.json();
      setHasAzCli(data.hasAzCli);
      setAdoConfig(data.config);
    } catch {}
  }, []);

  // Listen for pre-fetched data from startup
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    const tasksHandler = (data: { tasks: AppTask[] }) => {
      if (data.tasks?.length > 0) setTasks(data.tasks);
    };
    const adoHandler = (data: { tasks: AdoTask[] }) => {
      if (data.tasks?.length > 0) setAdoTasks(data.tasks);
    };
    socket.on('app:tasks-loaded' as any, tasksHandler);
    socket.on('app:ado-tasks-loaded' as any, adoHandler);
    return () => {
      socket.off('app:tasks-loaded' as any, tasksHandler);
      socket.off('app:ado-tasks-loaded' as any, adoHandler);
    };
  }, [socketRef]);

  useEffect(() => {
    if (isOpen) {
      // Only fetch if not already loaded from startup
      if (tasks.length === 0) fetchTasks();
      checkAdo();
    }
  }, [isOpen]);

  // CRUD
  const handleCreate = async () => {
    if (!newSubject.trim()) return;
    await fetch('/api/app-tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create', subject: newSubject.trim(), description: newDesc.trim(), type: newType, adoState: 'Proposed' }) });
    setNewSubject(''); setNewDesc(''); setNewType('Task'); setCreating(false); fetchTasks();
  };

  const handleDelete = async (id: string) => {
    await fetch('/api/app-tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id }) });
    fetchTasks();
  };

  const handleUpdate = async (id: string, changes: Record<string, unknown>) => {
    await fetch('/api/app-tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update', id, changes }) });
    fetchTasks();
    if (viewingTask?.id === id) {
      const updated = tasks.find(t => t.id === id);
      if (updated) setViewingTask({ ...updated, ...changes as Partial<AppTask> });
    }
  };

  const handleComment = async (id: string, text: string) => {
    await fetch('/api/app-tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'discuss', id, text }) });
    // Also push to ADO if it's an ADO task
    const task = tasks.find(t => t.id === id);
    if (task?.source === 'ado' && task.adoId) {
      fetch('/api/ado', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'comment', id: task.adoId, text }) }).catch(() => {});
    }
    fetchTasks();
    if (viewingTask?.id === id) {
      setViewingTask(prev => prev ? { ...prev, discussions: [...(prev.discussions || []), { author: 'User', text, timestamp: Date.now() }] } : null);
    }
  };

  const handleUnassign = async (task: AppTask) => {
    const socket = socketRef.current;
    if (socket && task.assignedTo) {
      socket.emit('terminal:input', { sessionId: task.assignedTo, data: `Delete the task with subject "${task.subject}". Use whatever task tool is available to set its status to "deleted". Just delete it and stop. Do NOT ask questions.\r` });
    }
    await handleUpdate(task.id, { status: 'pending', assignedTo: null, assignedToName: null, assignedAt: null });
  };

  const handleAssign = async () => {
    if (!assigningTask || !selectedSessionId) return;
    const socket = socketRef.current;
    if (!socket) return;
    const sessionData = sessions.get(selectedSessionId);

    // Write task details to file
    const writeRes = await fetch('/api/app-tasks/assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: selectedSessionId,
        taskId: assigningTask.id,
        subject: assigningTask.subject,
        description: assigningTask.description,
        type: assigningTask.type,
        priority: assigningTask.priority,
        discussions: assigningTask.discussions,
      }),
    });
    const { filePath } = await writeRes.json();

    // Update app task status
    await handleUpdate(assigningTask.id, {
      status: 'assigned',
      assignedTo: selectedSessionId,
      assignedToName: sessionData?.name || selectedSessionId.slice(0, 8),
      assignedAt: Date.now(),
    });

    // Tell Claude to read the task file (non-blocking)
    const taskId = assigningTask.id;
    socket.emit('terminal:input', {
      sessionId: selectedSessionId,
      data: `Read the task assignment file at ${filePath}. Internalize the task details — subject, description, comments, and context. Do NOT start working on it yet. Just acknowledge you understand the task. Delete the file when done reading.\r`,
    });

    // Cleanup fallback — delete file after 60s if Claude doesn't
    setTimeout(() => {
      fetch('/api/app-tasks/assign', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: selectedSessionId, taskId }),
      }).catch(() => {});
    }, 60000);

    setAssigningTask(null);
    if (onOpenSession) { onClose(); setTimeout(() => onOpenSession(selectedSessionId), 150); }
  };

  // ADO
  const fetchProjects = async (org: string) => {
    setOrgError('');
    setProjectsLoading(true);
    try {
      const res = await fetch(`/api/ado?action=projects&org=${encodeURIComponent(org)}`);
      const data = await res.json();
      if (!data.projects || data.projects.length === 0) { setOrgError('No projects found'); setProjects([]); }
      else { setProjects(data.projects); setSetupProject(data.projects[0]); }
    } catch { setOrgError('Failed to connect'); setProjects([]); }
    setProjectsLoading(false);
  };

  const handleAdoConfigure = async () => {
    if (!setupOrg || !setupProject) return;
    await fetch('/api/ado', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'configure', organization: setupOrg, project: setupProject }) });
    setAdoConfig({ organization: setupOrg, project: setupProject, configured: true });
  };

  const fetchAdoTasks = async () => {
    setAdoLoading(true);
    try {
      const res = await fetch('/api/ado?action=tasks');
      const data = await res.json();
      setAdoTasks(data.tasks || []);
    } catch {}
    setAdoLoading(false);
  };

  // Fetch ADO tasks when config first set (after setup)
  useEffect(() => {
    if (adoConfig.configured && adoTasks.length === 0) fetchAdoTasks();
  }, [adoConfig.configured]);

  const handleImportAdo = async (ado: AdoTask) => {
    // Fetch comments on import
    let discussions: Discussion[] = [];
    try {
      const res = await fetch(`/api/ado?action=comments&id=${ado.adoId}`);
      const data = await res.json();
      discussions = data.comments || [];
    } catch {}
    await fetch('/api/app-tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create', subject: ado.title, description: ado.description, source: 'ado', adoId: ado.adoId, adoState: ado.state, state: ado.state, type: ado.type, priority: ado.priority, discussions }) });
    fetchTasks(); setTab('app');
  };

  const handleSyncClaude = async (task: AppTask) => {
    if (!task.assignedTo) return;
    try {
      const writeRes = await fetch('/api/app-tasks/assign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: task.assignedTo, taskId: task.id, subject: task.subject,
          description: task.description, type: task.type,
          priority: task.priority, discussions: task.discussions,
        }),
      });
      const { filePath } = await writeRes.json();
      const socket = socketRef.current;
      if (socket) {
        socket.emit('terminal:input', {
          sessionId: task.assignedTo,
          data: `Read the updated task details at ${filePath}. Sync your understanding of this task with the new information. Delete the file when done.\r`,
        });
      }
      setTimeout(() => {
        fetch('/api/app-tasks/assign', {
          method: 'DELETE', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: task.assignedTo, taskId: task.id }),
        }).catch(() => {});
      }, 60000);

      // Navigate to the session's console
      const targetSession = task.assignedTo!;
      setViewingTask(null);
      onClose();
      if (onOpenSession) onOpenSession(targetSession);
    } catch {}
  };

  const handleSyncAdo = async (task: AppTask) => {
    if (!task.adoId) return;
    try {
      // Push local state to ADO if it differs
      const localState = task.state || task.adoState;
      if (localState) {
        await fetch('/api/ado', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'update', id: task.adoId, state: localState }),
        });
      }

      // Pull latest from ADO
      const res = await fetch(`/api/ado?action=sync&id=${task.adoId}`);
      const data = await res.json();
      if (data.title) {
        // Merge comments
        const adoComments: Discussion[] = data.comments || [];
        const appComments = (task.discussions || []).filter(d => d.author === 'User');
        const existingTimestamps = new Set((task.discussions || []).map(d => d.timestamp));
        const newAdoComments = adoComments.filter(c => !existingTimestamps.has(c.timestamp));
        const merged = [...appComments, ...adoComments.filter(c => existingTimestamps.has(c.timestamp)), ...newAdoComments]
          .sort((a, b) => a.timestamp - b.timestamp);

        const changes: Record<string, unknown> = {
          subject: data.title,
          adoState: data.state,
          state: data.state,
          type: data.type,
          priority: data.priority,
          description: data.description,
          discussions: merged,
        };
        await handleUpdate(task.id, changes);
        setViewingTask(prev => prev ? { ...prev, ...changes as Partial<AppTask> } : null);
      }
    } catch {}
  };

  const sessionList = Array.from(sessions.values());

  // Apply search + filters
  const filteredTasks = tasks.filter(t => {
    if (search) {
      const q = search.toLowerCase();
      const matchText = t.subject.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q);
      const matchId = t.adoId?.toString().includes(q);
      if (!matchText && !matchId) return false;
    }
    if (filterState !== 'all' && (t.state || t.adoState || 'Proposed') !== filterState) return false;
    if (filterType !== 'all' && (t.type || 'Task') !== filterType) return false;
    return true;
  });

  const pending = filteredTasks.filter(t => t.status === 'pending');
  const assigned = filteredTasks.filter(t => t.status === 'assigned');
  const completed = filteredTasks.filter(t => t.status === 'completed');

  // ADO search
  const filteredAdoTasks = adoTasks.filter(t => {
    if (!search) return true;
    const q = search.toLowerCase();
    return t.title.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q) || t.adoId.toString().includes(q);
  });

  // Collect unique types and states for filter options
  const activeTypes = [...new Set(tasks.map(t => t.type || 'Task'))];
  const activeStates = [...new Set(tasks.map(t => t.state || t.adoState || 'Proposed'))];

  if (!isOpen) return null;

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 46 }} />
      <div style={{
        position: 'fixed', top: 'var(--header-height)', right: 0, width,
        height: 'calc(100vh - var(--header-height))', background: '#111118', borderLeft: '1px solid #222235',
        zIndex: 47, display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Resize handle */}
        <div onMouseDown={handleMouseDown} style={{
          position: 'absolute', top: 0, left: 0, width: 5, height: '100%',
          cursor: 'col-resize', zIndex: 2, background: 'transparent',
        }} />

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #1e1e30' }}>
          <span style={{ fontSize: 20, fontWeight: 800, color: '#eee' }}>Task Board</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {tab === 'app' && <button onClick={() => setCreating(true)} style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: '#4a9eff', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>+ New</button>}
            <button onClick={() => { tab === 'app' ? fetchTasks() : fetchAdoTasks(); }} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #2a2a3e', background: '#1a1a2a', color: '#aaa', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Refresh</button>
            <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #2a2a3e', background: '#1a1a2a', color: '#888', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>X</button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #1e1e30', padding: '0 20px' }}>
          {([['app', 'In App'], ['ado', 'Azure DevOps']] as [Tab, string][]).map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)} style={{
              padding: '10px 20px', fontSize: 14, fontWeight: 700, cursor: 'pointer',
              color: tab === key ? '#eee' : '#666', background: 'none', border: 'none', fontFamily: 'inherit',
              borderBottom: `2px solid ${tab === key ? '#4a9eff' : 'transparent'}`,
            }}>{label}</button>
          ))}
        </div>

        {/* Search + Filters */}
        <div style={{ padding: '10px 20px', borderBottom: '1px solid #1e1e30' }}>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder={tab === 'ado' ? 'Search by title or #ID...' : 'Search tasks...'}
            style={{ width: '100%', background: '#1a1a2a', border: '1px solid #2a2a3e', color: '#eee', borderRadius: 6, padding: '9px 14px', fontSize: 14, fontWeight: 600, fontFamily: 'inherit', marginBottom: 8 }}
          />
          {tab === 'app' && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {/* State filter */}
              {['all', ...TASK_STATES].map(s => (
                <button key={s} onClick={() => setFilterState(s)} style={{
                  padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700,
                  border: filterState === s ? `1.5px solid ${STATE_COLORS[s] || '#4a9eff'}` : '1px solid #222235',
                  background: filterState === s ? (STATE_COLORS[s] || '#4a9eff') + '12' : 'transparent',
                  color: filterState === s ? STATE_COLORS[s] || '#4a9eff' : '#555',
                  cursor: 'pointer', fontFamily: 'inherit', textTransform: 'capitalize',
                }}>{s === 'all' ? 'All States' : s}</button>
              ))}
              <span style={{ width: 1, background: '#222235', margin: '0 2px' }} />
              {/* Type filter */}
              {['all', ...TASK_TYPES].map(t => (
                <button key={t} onClick={() => setFilterType(t)} style={{
                  padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700,
                  border: filterType === t ? '1.5px solid #cc5de8' : '1px solid #222235',
                  background: filterType === t ? '#cc5de812' : 'transparent',
                  color: filterType === t ? '#cc5de8' : '#555',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}>{t === 'all' ? 'All Types' : `${TYPE_ICONS[t] || ''} ${t}`}</button>
              ))}
            </div>
          )}
        </div>

        {/* Create form */}
        {creating && tab === 'app' && (
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #1e1e30' }}>
            <input value={newSubject} onChange={e => setNewSubject(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleCreate()} placeholder="Task name..." autoFocus style={{ width: '100%', background: '#1a1a2a', border: '1px solid #2a2a3e', color: '#eee', borderRadius: 6, padding: '10px 14px', fontSize: 15, fontWeight: 600, fontFamily: 'inherit', marginBottom: 8 }} />
            <textarea value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Description..." rows={2} style={{ width: '100%', background: '#1a1a2a', border: '1px solid #2a2a3e', color: '#eee', borderRadius: 6, padding: '10px 14px', fontSize: 14, fontFamily: 'inherit', resize: 'vertical', marginBottom: 8 }} />
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              {TASK_TYPES.slice(0, 4).map(t => (
                <button key={t} onClick={() => setNewType(t)} style={{
                  padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700,
                  border: newType === t ? '1.5px solid #cc5de8' : '1px solid #2a2a3e',
                  background: newType === t ? '#cc5de812' : '#1a1a2a',
                  color: newType === t ? '#cc5de8' : '#888',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}>{TYPE_ICONS[t]} {t}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setCreating(false)} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #2a2a3e', background: '#1a1a2a', color: '#888', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
              <button onClick={handleCreate} disabled={!newSubject.trim()} style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: newSubject.trim() ? '#4a9eff' : '#1e1e30', color: newSubject.trim() ? '#fff' : '#555', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Create</button>
            </div>
          </div>
        )}

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px' }}>
          {tab === 'app' ? (
            loading ? <div style={{ color: '#888', padding: 20, textAlign: 'center' }}>Loading...</div>
            : tasks.length === 0 ? <div style={{ color: '#666', padding: 40, textAlign: 'center' }}>No tasks yet</div>
            : [
              { label: 'Assigned', items: assigned, color: STATUS_COLORS.assigned },
              { label: 'Pending', items: pending, color: STATUS_COLORS.pending },
              { label: 'Completed', items: completed, color: STATUS_COLORS.completed },
            ].filter(g => g.items.length > 0).map(group => (
              <div key={group.label} style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: group.color }} />
                  {group.label} ({group.items.length})
                </div>
                <div style={{ background: '#12121e', borderRadius: 10, border: '1px solid #1e1e30', overflow: 'hidden' }}>
                  {group.items.map((task, i) => {
                    const icon = TYPE_ICONS[task.type || ''] || (task.source === 'ado' ? '\uD83D\uDD35' : '');
                    return (
                      <div key={task.id} onClick={() => setViewingTask(task)} style={{
                        padding: '12px 14px', borderBottom: i < group.items.length - 1 ? '1px solid #1a1a28' : 'none',
                        cursor: 'pointer', transition: 'background 0.1s',
                      }}
                        onMouseEnter={e => e.currentTarget.style.background = '#1a1a2e'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              {icon && <span style={{ fontSize: 14 }}>{icon}</span>}
                              <span style={{ fontSize: 15, color: '#eee', fontWeight: 700 }}>{task.subject}</span>
                            </div>
                            {task.description && <div style={{ fontSize: 13, color: '#777', marginTop: 4, fontWeight: 500 }}>{task.description.slice(0, 80)}</div>}
                            <div style={{ display: 'flex', gap: 5, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                              {(() => { const st = task.state || task.adoState || 'Proposed'; return <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: (STATE_COLORS[st] || '#888') + '15', color: STATE_COLORS[st] || '#888', fontWeight: 700 }}>{st}</span>; })()}
                              {task.adoId && adoConfig.configured && (
                                <a href={getAdoItemUrl(adoConfig.organization, adoConfig.project, task.adoId)} target="_blank" rel="noopener noreferrer"
                                  onClick={e => e.stopPropagation()}
                                  style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: '#4a9eff10', color: '#4a9eff', fontWeight: 700, textDecoration: 'none', cursor: 'pointer' }}>
                                  #{task.adoId} ↗
                                </a>
                              )}
                              {task.adoId && !adoConfig.configured && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: '#4a9eff10', color: '#4a9eff', fontWeight: 700 }}>#{task.adoId}</span>}
                              {task.assignedToName && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: '#4a9eff20', color: '#7aafff', fontWeight: 700 }}>{task.assignedToName}</span>}
                              {(task.discussions?.length || 0) > 0 && <span style={{ fontSize: 10, color: '#555', fontWeight: 600 }}>{task.discussions.length} comment{task.discussions.length > 1 ? 's' : ''}</span>}
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                            {task.status === 'pending' && <button onClick={() => { setAssigningTask(task); setSelectedSessionId(sessionList[0]?.id || ''); }} style={{ padding: '4px 8px', borderRadius: 4, border: 'none', background: '#4a9eff', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Assign</button>}
                            {task.status === 'assigned' && <button onClick={() => handleUnassign(task)} style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #ffd43b40', background: 'transparent', color: '#ffd43b', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Unassign</button>}
                            <button onClick={() => handleDelete(task.id)} style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #ff6b6b30', background: 'transparent', color: '#ff6b6b', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Del</button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          ) : (
            /* ADO tab */
            !hasAzCli ? (
              <div style={{ color: '#888', padding: 40, textAlign: 'center' }}>
                <div style={{ fontSize: 16, color: '#eee', fontWeight: 700, marginBottom: 8 }}>Azure CLI not found</div>
                <div style={{ fontSize: 14 }}>Install <code style={{ background: '#1a1a2a', padding: '2px 6px', borderRadius: 4 }}>az</code> and the DevOps extension.</div>
              </div>
            ) : !adoConfig.configured ? (
              <div style={{ padding: '20px 0' }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#eee', marginBottom: 14 }}>Configure Azure DevOps</div>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 13, color: '#888', fontWeight: 700, marginBottom: 6 }}>Organization</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input value={setupOrg} onChange={e => { setSetupOrg(e.target.value); setProjects([]); setOrgError(''); }}
                      placeholder="e.g. mycompany" onKeyDown={e => { if (e.key === 'Enter' && setupOrg.trim()) fetchProjects(setupOrg.trim()); }}
                      style={{ flex: 1, background: '#1a1a2a', border: `1px solid ${orgError ? '#ff4444' : '#2a2a3e'}`, color: '#eee', borderRadius: 6, padding: '10px 14px', fontSize: 14, fontWeight: 600, fontFamily: 'inherit' }}
                    />
                    <button onClick={() => setupOrg.trim() && fetchProjects(setupOrg.trim())} disabled={!setupOrg.trim() || projectsLoading}
                      style={{ padding: '10px 14px', borderRadius: 6, border: 'none', background: setupOrg.trim() ? '#4a9eff' : '#1e1e30', color: setupOrg.trim() ? '#fff' : '#555', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                      {projectsLoading ? 'Loading...' : 'Load Projects'}
                    </button>
                  </div>
                  {orgError && <div style={{ fontSize: 12, color: '#ff6666', marginTop: 6, fontWeight: 600 }}>{orgError}</div>}
                  <div style={{ fontSize: 12, color: '#555', marginTop: 4 }}>e.g. <strong style={{ color: '#888' }}>myorg</strong> or <strong style={{ color: '#888' }}>myorg.visualstudio.com</strong></div>
                </div>
                {projects.length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 13, color: '#888', fontWeight: 700, marginBottom: 6 }}>Project</div>
                    <select value={setupProject} onChange={e => setSetupProject(e.target.value)} style={{ width: '100%', background: '#1a1a2a', border: '1px solid #2a2a3e', color: '#eee', borderRadius: 6, padding: '10px 14px', fontSize: 14, fontWeight: 600, fontFamily: 'inherit' }}>
                      {projects.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                )}
                {projects.length > 0 && setupProject && (
                  <button onClick={handleAdoConfigure} style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: '#4a9eff', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Connect</button>
                )}
              </div>
            ) : (
              adoLoading ? <div style={{ color: '#888', padding: 20, textAlign: 'center' }}>Loading ADO tasks...</div>
              : filteredAdoTasks.length === 0 ? <div style={{ color: '#666', padding: 40, textAlign: 'center' }}>{search ? 'No matching work items' : 'No work items assigned to you'}</div>
              : <div style={{ background: '#12121e', borderRadius: 10, border: '1px solid #1e1e30', overflow: 'hidden' }}>
                  {filteredAdoTasks.map((ado, i) => {
                    const alreadyImported = tasks.some(t => t.adoId === ado.adoId);
                    const icon = TYPE_ICONS[ado.type] || '\uD83D\uDD35';
                    return (
                      <div key={ado.adoId} style={{ padding: '12px 14px', borderBottom: i < filteredAdoTasks.length - 1 ? '1px solid #1a1a28' : 'none' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontSize: 14 }}>{icon}</span>
                              <span style={{ fontSize: 15, color: '#eee', fontWeight: 700 }}>{ado.title}</span>
                            </div>
                            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: (STATE_COLORS[ado.state] || '#888') + '20', color: STATE_COLORS[ado.state] || '#888', fontWeight: 700 }}>{ado.state}</span>
                              <span style={{ fontSize: 11, color: '#555', fontWeight: 600 }}>#{ado.adoId}</span>
                            </div>
                            {ado.description && <div style={{ fontSize: 13, color: '#777', marginTop: 4, fontWeight: 500 }}>{ado.description.slice(0, 80)}</div>}
                          </div>
                          <button onClick={() => handleImportAdo(ado)} disabled={alreadyImported} style={{
                            padding: '6px 12px', borderRadius: 6, border: 'none',
                            background: alreadyImported ? '#1e1e30' : '#4a9eff',
                            color: alreadyImported ? '#555' : '#fff',
                            fontSize: 12, fontWeight: 700, cursor: alreadyImported ? 'default' : 'pointer',
                          }}>{alreadyImported ? 'Imported' : 'Import'}</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
            )
          )}
        </div>
      </div>

      {/* Assign modal */}
      {assigningTask && (
        <>
          <div onClick={() => setAssigningTask(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100 }} />
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 480, background: '#151520', border: '1px solid #2a2a3e', borderRadius: 12, zIndex: 101, padding: 20 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#eee', marginBottom: 14 }}>Assign Task</div>
            <div style={{ padding: '10px 14px', background: '#12121e', borderRadius: 8, border: '1px solid #1e1e30', marginBottom: 14 }}>
              <div style={{ fontSize: 15, color: '#eee', fontWeight: 700 }}>{assigningTask.subject}</div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 13, color: '#888', fontWeight: 700, marginBottom: 6 }}>Send to session</div>
              {sessionList.length === 0 ? <div style={{ fontSize: 14, color: '#666', fontStyle: 'italic' }}>No active sessions</div> : (
                <select value={selectedSessionId} onChange={e => setSelectedSessionId(e.target.value)} style={{ width: '100%', background: '#1a1a2a', border: '1px solid #2a2a3e', color: '#eee', borderRadius: 6, padding: '10px 14px', fontSize: 15, fontWeight: 600, fontFamily: 'inherit' }}>
                  {sessionList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setAssigningTask(null)} style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #3a3a4e', background: '#1e1e30', color: '#aaa', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
              <button onClick={handleAssign} disabled={!selectedSessionId} style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: selectedSessionId ? '#4a9eff' : '#1e1e30', color: selectedSessionId ? '#fff' : '#555', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Assign</button>
            </div>
          </div>
        </>
      )}

      {/* Task detail modal */}
      {viewingTask && (
        <TaskDetailModal
          task={viewingTask}
          onClose={() => setViewingTask(null)}
          onUpdate={handleUpdate}
          onComment={handleComment}
          onAssign={(t) => { setViewingTask(null); setAssigningTask(t); setSelectedSessionId(sessionList[0]?.id || ''); }}
          onDelete={handleDelete}
          onSync={handleSyncAdo}
          onSyncClaude={handleSyncClaude}
          sessions={sessions}
          adoConfig={adoConfig.configured ? adoConfig : undefined}
        />
      )}
    </>
  );
}
