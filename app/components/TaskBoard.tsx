'use client';

import { useState, useEffect, useCallback, useRef, type CSSProperties } from 'react';
import { ClipboardList, Plus, RefreshCw } from 'lucide-react';
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
const TASK_DATE_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

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
  onDelete: (id: string) => Promise<boolean>;
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
    <Modal
      isOpen
      onClose={onClose}
      title={task.subject}
      eyebrow={`${task.type || 'Task'} · ${taskState}`}
      description={task.description || 'No task description.'}
      icon={<span>{typeIcon}</span>}
      maxWidth={760}
      bodyClassName="cc-task-detail-body"
      footer={(
        <div className="cc-modal-footer-row">
          {task.status === 'pending' && <button onClick={() => onAssign(task)} style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: '#4a9eff', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Assign to Session</button>}
          {task.status === 'assigned' && task.assignedTo && onSyncClaude && (
            <button className="btn-outline" onClick={() => onSyncClaude(task)}>
              Sync to Session
            </button>
          )}
          {task.source === 'ado' && task.adoId && (
            <button className="btn-outline" onClick={handleSync} disabled={syncing}>
              {syncing ? 'Syncing...' : 'Sync with ADO'}
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button
            className="btn-destructive"
            onClick={async () => {
              if (await onDelete(task.id)) onClose();
            }}
          >
            Delete Task
          </button>
        </div>
      )}
    >
      <div className="cc-task-detail-badges">
        <span style={{ '--task-tone': statusColor } as CSSProperties}>{task.status}</span>
        <span style={{ '--task-tone': STATE_COLORS[taskState] || '#888' } as CSSProperties}>{taskState}</span>
        {task.adoId ? (
          adoConfig?.configured ? (
            <a href={getAdoItemUrl(adoConfig.organization, adoConfig.project, task.adoId)} target="_blank" rel="noopener noreferrer">
              ADO #{task.adoId} ↗
            </a>
          ) : <span>ADO #{task.adoId}</span>
        ) : null}
        {task.priority ? <span>P{task.priority}</span> : null}
        {task.assignedToName ? <span>Assigned: {task.assignedToName}</span> : null}
      </div>

      <div className="cc-task-detail-tabs" role="tablist" aria-label="Task detail">
        {(['details', 'comments'] as const).map(tab => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={modalTab === tab}
            onClick={() => setModalTab(tab)}
          >
            {tab === 'comments' ? `Comments (${task.discussions?.length || 0})` : 'Details'}
          </button>
        ))}
      </div>

      {modalTab === 'details' ? (
        <div className="cc-task-detail-panel" role="tabpanel">
          <FormField label="State">
            <OptionGroup>
              {TASK_STATES.map(state => (
                <OptionButton key={state} selected={taskState === state} onClick={() => handleStateChange(state)}>
                  {state}
                </OptionButton>
              ))}
            </OptionGroup>
          </FormField>
          <div className="cc-task-description-heading">
            <strong>Description</strong>
            <button type="button" onClick={() => { setEditingDesc(!editingDesc); setDescDraft(task.description); }}>
              {editingDesc ? 'Cancel' : 'Edit'}
            </button>
          </div>
          {editingDesc ? (
            <>
              <TextArea
                value={descDraft}
                onChange={setDescDraft}
                rows={6}
                name="task-detail-description"
                aria-label="Task description"
              />
              <button
                type="button"
                className="btn-primary cc-settings-field-action"
                onClick={() => {
                  onUpdate(task.id, { description: descDraft });
                  setEditingDesc(false);
                }}
              >
                Save Description
              </button>
            </>
          ) : (
            <div className="cc-task-description">{task.description || 'No description.'}</div>
          )}
        </div>
      ) : (
        <div className="cc-task-detail-panel" role="tabpanel">
          <div className="cc-task-comments">
            {task.discussions?.length ? task.discussions.map((discussion, index) => (
              <article key={`${discussion.timestamp}:${index}`}>
                <header>
                  <strong>{discussion.author}</strong>
                  <time>{TASK_DATE_FORMAT.format(new Date(discussion.timestamp))}</time>
                </header>
                <p>{discussion.text}</p>
              </article>
            )) : <div className="cc-modal-empty">No comments yet.</div>}
          </div>
          <div className="cc-task-comment-form">
            <TextInput
              value={newComment}
              onChange={setNewComment}
              name="task-comment"
              aria-label="Add a task comment"
              autoComplete="off"
              onKeyDown={event => {
                if (event.key === 'Enter' && newComment.trim()) {
                  onComment(task.id, newComment.trim());
                  setNewComment('');
                }
              }}
              placeholder="Add a comment…"
            />
            <button
              type="button"
              className="btn-primary"
              disabled={!newComment.trim()}
              onClick={() => {
                if (!newComment.trim()) return;
                onComment(task.id, newComment.trim());
                setNewComment('');
              }}
            >
              Add
            </button>
          </div>
        </div>
      )}
    </Modal>
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

  const handleDelete = async (id: string): Promise<boolean> => {
    const task = tasks.find(item => item.id === id);
    if (!window.confirm(`Delete "${task?.subject || 'this task'}"? This cannot be undone.`)) return false;
    await fetch('/api/app-tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id }) });
    await fetchTasks();
    return true;
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
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title="Task Board"
        eyebrow="Work Routing"
        description="Track app and Azure DevOps work, then route the selected task into an active CLI session."
        icon={<ClipboardList size={16} />}
        variant="drawer"
        width={width}
        bodyClassName="cc-task-board-body"
        bodyStyle={{ padding: 0 }}
        headerActions={(
          <>
            {tab === 'app' ? (
              <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
                <Plus size={13} aria-hidden="true" />
                New
              </button>
            ) : null}
            <button
              type="button"
              className="btn-outline"
              onClick={() => { tab === 'app' ? void fetchTasks() : void fetchAdoTasks(); }}
            >
              <RefreshCw size={13} aria-hidden="true" />
              Refresh
            </button>
          </>
        )}
      >
        <div className="cc-task-board-layout">
        {/* Resize handle */}
        <div onMouseDown={handleMouseDown} className="cc-task-resize-handle" />

        {/* Tabs */}
        <div className="cc-task-tabs" role="tablist" aria-label="Task source">
          {([['app', 'In App'], ['ado', 'Azure DevOps']] as [Tab, string][]).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Search + Filters */}
        <div style={{ padding: '10px 20px', borderBottom: '1px solid #1e1e30' }}>
          <input value={search} onChange={e => setSearch(e.target.value)}
            name="task-search"
            aria-label={tab === 'ado' ? 'Search Azure DevOps tasks' : 'Search tasks'}
            autoComplete="off"
            placeholder={tab === 'ado' ? 'Search by title or #ID…' : 'Search tasks…'}
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
            <input value={newSubject} onChange={e => setNewSubject(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleCreate()} name="task-subject" aria-label="Task name" autoComplete="off" placeholder="Task name…" autoFocus style={{ width: '100%', background: '#1a1a2a', border: '1px solid #2a2a3e', color: '#eee', borderRadius: 6, padding: '10px 14px', fontSize: 15, fontWeight: 600, fontFamily: 'inherit', marginBottom: 8 }} />
            <textarea value={newDesc} onChange={e => setNewDesc(e.target.value)} name="task-description" aria-label="Task description" autoComplete="off" placeholder="Description…" rows={2} style={{ width: '100%', background: '#1a1a2a', border: '1px solid #2a2a3e', color: '#eee', borderRadius: 6, padding: '10px 14px', fontSize: 14, fontFamily: 'inherit', resize: 'vertical', marginBottom: 8 }} />
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
                      <div
                        key={task.id}
                        style={{
                          borderBottom: i < group.items.length - 1 ? '1px solid #1a1a28' : 'none',
                          transition: 'background 0.1s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = '#1a1a2e'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                          <button
                            type="button"
                            onClick={() => setViewingTask(task)}
                            style={{
                              flex: 1, minWidth: 0, padding: '12px 14px',
                              border: 0, color: 'inherit', textAlign: 'left',
                              background: 'transparent', cursor: 'pointer',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              {icon && <span style={{ fontSize: 14 }}>{icon}</span>}
                              <span style={{ fontSize: 15, color: '#eee', fontWeight: 700 }}>{task.subject}</span>
                            </div>
                            {task.description && <div style={{ fontSize: 13, color: '#777', marginTop: 4, fontWeight: 500 }}>{task.description.slice(0, 80)}</div>}
                            <div style={{ display: 'flex', gap: 5, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                              {(() => { const st = task.state || task.adoState || 'Proposed'; return <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: (STATE_COLORS[st] || '#888') + '15', color: STATE_COLORS[st] || '#888', fontWeight: 700 }}>{st}</span>; })()}
                              {task.adoId && !adoConfig.configured && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: '#4a9eff10', color: '#4a9eff', fontWeight: 700 }}>#{task.adoId}</span>}
                              {task.assignedToName && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: '#4a9eff20', color: '#7aafff', fontWeight: 700 }}>{task.assignedToName}</span>}
                              {(task.discussions?.length || 0) > 0 && <span style={{ fontSize: 10, color: '#555', fontWeight: 600 }}>{task.discussions.length} comment{task.discussions.length > 1 ? 's' : ''}</span>}
                            </div>
                          </button>
                          <div style={{ display: 'flex', gap: 4, flexShrink: 0, padding: '12px 14px 12px 0' }}>
                            {task.adoId && adoConfig.configured && (
                              <a
                                href={getAdoItemUrl(adoConfig.organization, adoConfig.project, task.adoId)}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #4a9eff30', color: '#4a9eff', fontSize: 11, fontWeight: 700, textDecoration: 'none' }}
                              >
                                #{task.adoId} ↗
                              </a>
                            )}
                            {task.status === 'pending' && <button onClick={() => { setAssigningTask(task); setSelectedSessionId(sessionList[0]?.id || ''); }} style={{ padding: '4px 8px', borderRadius: 4, border: 'none', background: '#4a9eff', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Assign</button>}
                            {task.status === 'assigned' && <button onClick={() => handleUnassign(task)} style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #ffd43b40', background: 'transparent', color: '#ffd43b', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Unassign</button>}
                            <button onClick={() => void handleDelete(task.id)} style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #ff6b6b30', background: 'transparent', color: '#ff6b6b', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Del</button>
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
                  <div className="cc-task-ado-org-row">
                    <input value={setupOrg} onChange={e => { setSetupOrg(e.target.value); setProjects([]); setOrgError(''); }}
                      name="ado-organization"
                      aria-label="Azure DevOps organization"
                      autoComplete="off"
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
                    <select value={setupProject} onChange={e => setSetupProject(e.target.value)} name="ado-project" aria-label="Azure DevOps project" style={{ width: '100%', background: '#1a1a2a', border: '1px solid #2a2a3e', color: '#eee', borderRadius: 6, padding: '10px 14px', fontSize: 14, fontWeight: 600, fontFamily: 'inherit' }}>
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
      </Modal>

      {/* Assign modal */}
      {assigningTask && (
        <Modal
          isOpen
          onClose={() => setAssigningTask(null)}
          title="Assign Task"
          eyebrow="Work Routing"
          description="Send the task context to an active session, then return to its embedded CLI."
          icon={<ClipboardList size={16} />}
          maxWidth={500}
          footer={(
            <div className="cc-modal-footer-row">
              <button type="button" className="btn-outline" onClick={() => setAssigningTask(null)}>Cancel</button>
              <button type="button" className="btn-primary" onClick={() => void handleAssign()} disabled={!selectedSessionId}>
                Assign to Session
              </button>
            </div>
          )}
        >
          <div className="cc-task-assignment-summary">
            <span>{assigningTask.type || 'Task'}</span>
            <strong>{assigningTask.subject}</strong>
            {assigningTask.description ? <p>{assigningTask.description}</p> : null}
          </div>
          <FormField label="Target session">
            {sessionList.length === 0 ? (
              <div className="cc-modal-empty">No active sessions are available.</div>
            ) : (
              <SelectInput
                data-autofocus
                value={selectedSessionId}
                onChange={setSelectedSessionId}
                options={sessionList.map(session => ({ value: session.id, label: session.name }))}
              />
            )}
          </FormField>
        </Modal>
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
