import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Filter, Plus, Send, Trash2, Inbox, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';
import { tasksApi, projectsApi, usersApi, taskRequestsApi } from '@/api';
import { PageContainer, PageHeader, Avatar } from '@/components/Avatar';
import { Spinner } from '@/components/Spinner';
import { EmptyState } from '@/components/EmptyState';
import {
  PRIORITY_BADGE,
  PRIORITY_LABELS,
  DIFFICULTY_BADGE,
  DIFFICULTY_LABELS,
  REQUEST_STATUS_BADGE,
  REQUEST_STATUS_LABELS,
  STATUS_BADGE,
  STATUS_LABELS,
} from '@/lib/ui';
import { formatDate, fromNow } from '@/lib/format';
import type { Task, TaskRequest, TaskStatus } from '@/types';
import { useAuthStore } from '@/stores/auth';
import { canManage } from '@/lib/rbac';
import { TaskCreateModal } from '@/features/tasks/TaskCreateModal';
import { TaskRequestModal } from '@/features/tasks/TaskRequestModal';

export default function TasksListPage() {
  const user = useAuthStore((s) => s.user)!;
  const [params, setParams] = useSearchParams();
  const [showCreate, setShowCreate] = useState(false);
  const [showRequest, setShowRequest] = useState(false);

  const status = params.get('status') ?? undefined;
  const priority = params.get('priority') ?? undefined;
  const projectId = params.get('project') ?? undefined;
  const assigneeId = params.get('assignee') ?? undefined;
  const q = params.get('q') ?? '';

  const tasksQ = useQuery({
    queryKey: ['tasks', { status, priority, projectId, assigneeId, q }],
    queryFn: () => tasksApi.list({ status, priority, project: projectId, assignee: assigneeId, q }),
  });
  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: projectsApi.list });
  const usersQ = useQuery({ queryKey: ['users-list'], queryFn: usersApi.list, enabled: canManage(user.role) });

  // Workers see their own requests; managers see the same list (they can also
  // use the dedicated /tasks/requests page for the full review UI).
  const myRequestsQ = useQuery({
    queryKey: ['task-requests', 'mine'],
    queryFn: () => taskRequestsApi.list({}),
  });

  function setParam(key: string, val?: string) {
    const next = new URLSearchParams(params);
    if (!val) next.delete(key);
    else next.set(key, val);
    setParams(next, { replace: true });
  }

  return (
    <PageContainer>
      <PageHeader
        title={user.role === 'worker' ? 'My Tasks' : 'Tasks'}
        subtitle={
          user.role === 'worker'
            ? 'Your assigned tasks and the requests you have submitted'
            : 'All tasks across your team'
        }
        actions={
          <>
            <button className="btn-secondary" onClick={() => setShowRequest(true)}>
              <Send size={14} /> Request task
            </button>
            {canManage(user.role) ? (
              <button onClick={() => setShowCreate(true)} className="btn-primary">
                <Plus size={16} /> New task
              </button>
            ) : null}
          </>
        }
      />

      {/* Filters */}
      <div className="card p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div>
            <label className="label">Search</label>
            <input
              className="input"
              placeholder="title or description"
              value={q}
              onChange={(e) => setParam('q', e.target.value || undefined)}
            />
          </div>
          <div>
            <label className="label">Status</label>
            <select
              className="input"
              value={status ?? ''}
              onChange={(e) => setParam('status', e.target.value || undefined)}
            >
              <option value="">Any</option>
              {(Object.keys(STATUS_LABELS) as TaskStatus[]).map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Priority</label>
            <select
              className="input"
              value={priority ?? ''}
              onChange={(e) => setParam('priority', e.target.value || undefined)}
            >
              <option value="">Any</option>
              {Object.entries(PRIORITY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Project</label>
            <select
              className="input"
              value={projectId ?? ''}
              onChange={(e) => setParam('project', e.target.value || undefined)}
            >
              <option value="">Any</option>
              {projectsQ.data?.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          {canManage(user.role) ? (
            <div>
              <label className="label">Assignee</label>
              <select
                className="input"
                value={assigneeId ?? ''}
                onChange={(e) => setParam('assignee', e.target.value || undefined)}
              >
                <option value="">Any</option>
                {usersQ.data?.map((u) => (
                  <option key={u.id} value={u.id}>{u.fullName}</option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
      </div>

      {tasksQ.isLoading ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm">
          <Spinner /> Loading…
        </div>
      ) : tasksQ.isError ? (
        <p className="text-sm text-red-600">Failed to load tasks.</p>
      ) : !tasksQ.data || tasksQ.data.length === 0 ? (
        <EmptyState
          icon={<Filter size={28} />}
          title="No tasks match your filters"
          description="Try clearing filters, or create a new task."
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-5 py-3 text-left font-medium">Task</th>
                <th className="px-5 py-3 text-left font-medium">Status</th>
                <th className="px-5 py-3 text-left font-medium">Priority</th>
                <th className="px-5 py-3 text-left font-medium">Difficulty</th>
                <th className="px-5 py-3 text-left font-medium">Assignee</th>
                <th className="px-5 py-3 text-left font-medium">Project / Customer</th>
                <th className="px-5 py-3 text-left font-medium">Due</th>
                <th className="px-5 py-3 text-right font-medium">Hours</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {tasksQ.data!.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  projects={projectsQ.data ?? []}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* My requests — visible to everyone */}
      <MyRequests requests={myRequestsQ.data ?? []} loading={myRequestsQ.isLoading} />

      {showCreate && (
        <TaskCreateModal onClose={() => setShowCreate(false)} defaultProjectId={projectId} />
      )}
      {showRequest && <TaskRequestModal onClose={() => setShowRequest(false)} />}
    </PageContainer>
  );
}

function TaskRow({ task, projects }: { task: Task; projects: any[] }) {
  const proj = projects.find((p) => p.id === task.projectId);
  return (
    <tr className="hover:bg-slate-50">
      <td className="px-5 py-3">
        <Link to={`/tasks/${task.id}`} className="text-slate-900 font-medium hover:underline">
          {task.title}
        </Link>
        {task.description && (
          <div className="text-xs text-slate-500 line-clamp-1 mt-0.5">{task.description}</div>
        )}
      </td>
      <td className="px-5 py-3">
        <span className={STATUS_BADGE[task.status]}>{STATUS_LABELS[task.status]}</span>
      </td>
      <td className="px-5 py-3">
        <span className={PRIORITY_BADGE[task.priority]}>{PRIORITY_LABELS[task.priority]}</span>
      </td>
      <td className="px-5 py-3">
        <span className={DIFFICULTY_BADGE[task.difficulty]}>{DIFFICULTY_LABELS[task.difficulty]}</span>
      </td>
      <td className="px-5 py-3">
        {task.assignee ? (
          <div className="flex items-center gap-2">
            <Avatar name={task.assignee.fullName} size="sm" />
            <span className="truncate max-w-[160px]">{task.assignee.fullName}</span>
          </div>
        ) : (
          <span className="text-slate-400">Unassigned</span>
        )}
      </td>
      <td className="px-5 py-3">
        {proj && (
          <span className="inline-flex items-center gap-1 text-sm text-slate-700">
            <span className="w-2 h-2 rounded-full" style={{ background: proj.color }} />
            {proj.name}
            {proj.customer && (
              <span className="text-xs text-slate-400">· {proj.customer.name}</span>
            )}
          </span>
        )}
      </td>
      <td className="px-5 py-3 text-slate-600">{task.dueDate ? formatDate(task.dueDate) : '—'}</td>
      <td className="px-5 py-3 text-right font-mono text-slate-700">
        {task.actualHours.toFixed(1)}
      </td>
    </tr>
  );
}

function MyRequests({ requests, loading }: { requests: TaskRequest[]; loading: boolean }) {
  const user = useAuthStore((s) => s.user)!;
  const qc = useQueryClient();
  const [editing, setEditing] = useState<TaskRequest | null>(null);

  const cancelMut = useMutation({
    mutationFn: (id: string) => taskRequestsApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['task-requests'] });
      toast.success('Request cancelled');
    },
    onError: (e: any) => toast.error(e?.message ?? 'Failed to cancel'),
  });

  // Workers see only their own requests (backend enforces this for them too).
  const visible = user.role === 'worker'
    ? requests.filter((r) => r.requester?.id === user.id)
    : requests;

  if (loading) return null;
  if (visible.length === 0) return null;

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-2">
          <Inbox size={14} />
          {user.role === 'worker' ? 'My requests' : 'Recent requests'}
          <span className="font-mono normal-case text-slate-400">{visible.length}</span>
        </h2>
        {canManage(user.role) && (
          <Link to="/tasks/requests" className="text-sm text-brand-600 hover:underline">
            Review queue →
          </Link>
        )}
      </div>
      <div className="card overflow-hidden">
        <ul className="divide-y divide-slate-100">
          {visible.map((r) => (
            <li key={r.id} className="px-5 py-3 flex flex-wrap items-start gap-3">
              <span className={REQUEST_STATUS_BADGE[r.status]}>
                {REQUEST_STATUS_LABELS[r.status]}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="font-medium text-slate-800">{r.title}</span>
                  {r.project && (
                    <span className="text-xs text-slate-500">
                      · {r.project.name}
                    </span>
                  )}
                  <span className={PRIORITY_BADGE[r.priority]}>{PRIORITY_LABELS[r.priority]}</span>
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {r.dueDate ? `Due ${formatDate(r.dueDate)} · ` : ''}
                  Submitted {fromNow(r.createdAt)}
                  {r.reviewer && ` · Reviewed by ${r.reviewer.fullName} ${fromNow(r.reviewedAt!)}`}
                </div>
                {r.reviewNote && (
                  <div className="mt-1 text-xs text-slate-600 italic">"{r.reviewNote}"</div>
                )}
                {r.createdTaskId && (
                  <div className="mt-1 text-xs">
                    <Link
                      to={`/tasks/${r.createdTaskId}`}
                      className="text-emerald-700 hover:underline"
                    >
                      ✓ Created as task →
                    </Link>
                  </div>
                )}
              </div>
              {r.status === 'pending' && r.requester?.id === user.id && (
                <div className="flex items-center gap-1 text-slate-400">
                  <button
                    className="p-1.5 rounded hover:text-brand-600 hover:bg-brand-50"
                    onClick={() => setEditing(r)}
                    title="Edit request"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    className="p-1.5 rounded hover:text-red-600 hover:bg-red-50"
                    onClick={() => {
                      if (confirm('Cancel this request?')) cancelMut.mutate(r.id);
                    }}
                    title="Cancel request"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
      {editing && (
        <TaskRequestModal request={editing} onClose={() => setEditing(null)} />
      )}
    </section>
  );
}