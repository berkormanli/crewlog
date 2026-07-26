import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Building2, CheckSquare, Plus, Users, Calendar, FileText } from 'lucide-react';
import { projectsApi, tasksApi, documentsApi, workLogsApi } from '@/api';
import { PageContainer, PageHeader, Avatar } from '@/components/Avatar';
import { Spinner } from '@/components/Spinner';
import { EmptyState } from '@/components/EmptyState';
import { STATUS_BADGE, STATUS_LABELS, PRIORITY_BADGE, PRIORITY_LABELS } from '@/lib/ui';
import { formatDate, fromNow } from '@/lib/format';
import { TaskCreateModal } from '@/features/tasks/TaskCreateModal';
import { useAuthStore } from '@/stores/auth';
import { canManage } from '@/lib/rbac';

const TABS = ['overview', 'tasks', 'logs', 'documents'] as const;

export default function ProjectDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user)!;
  const [tab, setTab] = useState<(typeof TABS)[number]>('overview');
  const [showCreateTask, setShowCreateTask] = useState(false);
  const qc = useQueryClient();

  const projectQ = useQuery({ queryKey: ['project', id], queryFn: () => projectsApi.get(id) });
  const tasksQ = useQuery({ queryKey: ['tasks', { project: id }], queryFn: () => tasksApi.list({ project: id }) });
  const docsQ = useQuery({
    queryKey: ['documents', { projectId: id }],
    queryFn: () => documentsApi.list({ project: id }),
  });
  // Member log timeline (used in logs tab)
  const logsQ = useQuery({
    queryKey: ['project', id, 'logs'],
    queryFn: () => workLogsApi.list({ project: id }),
  });

  if (projectQ.isLoading) {
    return (
      <PageContainer>
        <div className="flex items-center gap-2 text-slate-500 text-sm">
          <Spinner /> Loading…
        </div>
      </PageContainer>
    );
  }
  if (projectQ.isError || !projectQ.data) {
    return (
      <PageContainer>
        <button onClick={() => navigate(-1)} className="btn-ghost">
          <ArrowLeft size={16} /> Back
        </button>
        <p className="text-sm text-red-600 mt-4">Project not found.</p>
      </PageContainer>
    );
  }

  const p = projectQ.data;
  const tasks = tasksQ.data ?? [];
  const docs = docsQ.data ?? [];
  const logs = logsQ.data?.items ?? [];

  return (
    <PageContainer>
      <div className="mb-4">
        <Link to="/projects" className="btn-ghost">
          <ArrowLeft size={16} /> All projects
        </Link>
      </div>

      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <span className="w-3 h-12 rounded-full" style={{ background: p.color }} />
            <span>{p.name}</span>
          </span>
        }
        subtitle={
          <span className="font-mono text-xs flex items-center gap-3 flex-wrap">
            <span>{p.code}</span>
            {p.customer ? (
              <Link
                to={`/customers/${p.customer.id}`}
                className="inline-flex items-center gap-1 normal-case font-sans text-brand-700 hover:underline"
              >
                <Building2 size={12} /> {p.customer.name}
              </Link>
            ) : p.clientName ? (
              <span className="normal-case font-sans text-slate-600">
                Client: {p.clientName}
              </span>
            ) : (
              <span className="normal-case font-sans text-slate-400">No customer</span>
            )}
          </span>
        }
        actions={
          canManage(user.role) ? (
            <button className="btn-primary" onClick={() => setShowCreateTask(true)}>
              <Plus size={16} /> New task
            </button>
          ) : null
        }
      />

      {/* Tabs */}
      <div className="border-b border-slate-200 mb-6 flex gap-1">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px transition ${
              tab === t
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2 card p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-700">About</h3>
            <p className="text-sm text-slate-700 whitespace-pre-wrap">{p.description || '—'}</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm mt-2">
              <Kv label="Status" value={<span className={p.status === 'active' ? 'badge-green' : 'badge-gray'}>{p.status}</span>} />
              <Kv label="Start" value={p.startDate ? formatDate(p.startDate) : '—'} />
              <Kv label="End" value={p.endDate ? formatDate(p.endDate) : '—'} />
              <Kv label="Created" value={formatDate(p.createdAt)} />
            </div>
          </div>
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-1.5">
              <Users size={16} /> Members ({p.members?.length ?? 0})
            </h3>
            <ul className="space-y-2 text-sm">
              {(p.members ?? []).map((m) => (
                <li key={m.id} className="flex items-center gap-2">
                  <Avatar name={m.fullName} size="sm" />
                  <div className="min-w-0">
                    <div className="text-slate-800 font-medium truncate">{m.fullName}</div>
                    <div className="text-xs text-slate-500 capitalize">
                      {m.roleInProject} · {m.role}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-1.5">
              <CheckSquare size={16} /> Tasks
            </h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {(Object.keys(STATUS_LABELS) as Array<keyof typeof STATUS_LABELS>).map((s) => {
                const n = tasks.filter((t) => t.status === s).length;
                return (
                  <div key={s} className="flex items-center justify-between">
                    <span className={STATUS_BADGE[s]}>{STATUS_LABELS[s]}</span>
                    <span className="font-mono text-slate-700">{n}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-1.5">
              <Calendar size={16} /> Hours (last 30 days)
            </h3>
            <div className="text-3xl font-bold text-brand-700">
              {logs.reduce((s, l) => s + (l.hours ?? 0), 0).toFixed(2)}h
            </div>
            <div className="text-xs text-slate-500 mt-1">{logs.length} entries</div>
          </div>
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-1.5">
              <FileText size={16} /> Documents
            </h3>
            <div className="text-3xl font-bold text-slate-800">{docs.length}</div>
          </div>
        </div>
      )}

      {tab === 'tasks' && (
        <div className="card overflow-hidden">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-5 py-3 text-left font-medium">Task</th>
                <th className="px-5 py-3 text-left font-medium">Status</th>
                <th className="px-5 py-3 text-left font-medium">Priority</th>
                <th className="px-5 py-3 text-left font-medium">Assignee</th>
                <th className="px-5 py-3 text-left font-medium">Due</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tasks.length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-500">No tasks yet</td></tr>
              ) : (
                tasks.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <Link to={`/tasks/${t.id}`} className="font-medium text-slate-900 hover:underline">
                        {t.title}
                      </Link>
                    </td>
                    <td className="px-5 py-3"><span className={STATUS_BADGE[t.status]}>{STATUS_LABELS[t.status]}</span></td>
                    <td className="px-5 py-3"><span className={PRIORITY_BADGE[t.priority]}>{PRIORITY_LABELS[t.priority]}</span></td>
                    <td className="px-5 py-3 text-slate-600">{t.assignee?.fullName ?? '—'}</td>
                    <td className="px-5 py-3 text-slate-600">{t.dueDate ? formatDate(t.dueDate) : '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'logs' && (
        <div className="space-y-2">
          {logs.length === 0 ? (
            <EmptyState title="No logs yet" />
          ) : (
            logs.map((l) => (
              <div key={l.id} className="card px-5 py-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm">
                    <span className="font-medium text-slate-800">{l.worker?.fullName ?? '—'}</span>
                    {l.task && <span className="text-slate-500"> · {l.task.title}</span>}
                    <span className="ml-2 text-xs text-slate-400">{formatDate(l.date)}</span>
                  </div>
                  {l.description && <p className="text-sm text-slate-600 mt-1">{l.description}</p>}
                </div>
                <span className="font-mono text-sm text-brand-700">{(l.hours ?? 0).toFixed(2)}h</span>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'documents' && (
        <div className="card overflow-hidden">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-5 py-3 text-left font-medium">Name</th>
                <th className="px-5 py-3 text-left font-medium">Uploader</th>
                <th className="px-5 py-3 text-left font-medium">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {docs.length === 0 ? (
                <tr><td colSpan={3} className="px-5 py-8 text-center text-slate-500">No documents yet</td></tr>
              ) : (
                docs.map((d) => (
                  <tr key={d.id}>
                    <td className="px-5 py-3 font-medium">{d.name}</td>
                    <td className="px-5 py-3 text-slate-600">{d.uploader?.fullName ?? '—'}</td>
                    <td className="px-5 py-3 text-slate-500">{fromNow(d.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {showCreateTask && (
        <TaskCreateModal
          onClose={() => setShowCreateTask(false)}
          defaultProjectId={id}
          onCreated={() => qc.invalidateQueries({ queryKey: ['tasks', { project: id }] })}
        />
      )}
    </PageContainer>
  );
}

function Kv({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-slate-800 font-medium mt-0.5">{value}</div>
    </div>
  );
}
