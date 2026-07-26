import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Calendar, CheckSquare, Clock, FolderKanban } from 'lucide-react';
import { dashboardApi } from '@/api';
import { PageContainer, PageHeader, Avatar } from '@/components/Avatar';
import { Spinner } from '@/components/Spinner';
import { formatDate, fromNow } from '@/lib/format';
import { useAuthStore } from '@/stores/auth';
import { canManage } from '@/lib/rbac';
import { STATUS_BADGE, STATUS_LABELS } from '@/lib/ui';

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user)!;
  const meQ = useQuery({ queryKey: ['dashboard', 'me'], queryFn: dashboardApi.me });
  const mgrQ = useQuery({
    queryKey: ['dashboard', 'manager'],
    queryFn: dashboardApi.manager,
    enabled: canManage(user.role),
  });

  return (
    <PageContainer>
      <PageHeader
        title={`Hi, ${user.fullName.split(' ')[0]} 👋`}
        subtitle={
          <span>
            Today is {formatDate(new Date().toISOString(), 'EEEE, MMMM d')} — {new Date().toLocaleDateString()}
          </span>
        }
      />

      {meQ.isLoading ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm">
          <Spinner /> Loading your dashboard…
        </div>
      ) : meQ.isError ? (
        <p className="text-red-600 text-sm">Failed to load dashboard.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard
            icon={<Clock className="text-brand-600" size={20} />}
            label="Today's hours"
            value={(meQ.data?.todayHours ?? 0).toFixed(2)}
            hint={
              <Link to="/logs/timesheet" className="text-brand-600 hover:underline text-sm">
                Open timesheet →
              </Link>
            }
          />
          <StatCard
            icon={<CheckSquare className="text-emerald-600" size={20} />}
            label="Open tasks"
            value={String(meQ.data?.openTaskCount ?? 0)}
            hint={
              <Link to="/tasks" className="text-brand-600 hover:underline text-sm">
                View tasks →
              </Link>
            }
          />
          <StatCard
            icon={<Calendar className="text-amber-600" size={20} />}
            label="Recent logs"
            value={String(meQ.data?.recentLogs.length ?? 0)}
            hint={
              <Link to="/logs" className="text-brand-600 hover:underline text-sm">
                All logs →
              </Link>
            }
          />
        </div>
      )}

      {canManage(user.role) && (
        <>
          <h2 className="mt-10 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Manager view
          </h2>
          {mgrQ.isLoading ? (
            <div className="flex items-center gap-2 text-slate-500 text-sm mt-3">
              <Spinner /> Loading team data…
            </div>
          ) : mgrQ.data?.hidden ? null : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3">
              <StatCard
                icon={<Clock className="text-brand-600" size={20} />}
                label="Team hours this week"
                value={(mgrQ.data?.teamHoursThisWeek ?? 0).toFixed(2)}
              />
              <StatCard
                icon={<CheckSquare className="text-red-600" size={20} />}
                label="Overdue tasks"
                value={String(mgrQ.data?.overdueTaskCount ?? 0)}
              />
              <div className="card p-5">
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <FolderKanban size={18} className="text-purple-600" /> Top projects
                </div>
                <ul className="mt-3 space-y-1.5">
                  {(mgrQ.data?.topProjects ?? []).length === 0 && (
                    <li className="text-sm text-slate-400">No activity yet.</li>
                  )}
                  {mgrQ.data?.topProjects.map((p) => (
                    <li key={p.id} className="flex justify-between text-sm">
                      <Link to={`/projects/${p.id}`} className="text-slate-800 hover:underline">
                        <span
                          className="inline-block w-2 h-2 rounded-full mr-2 align-middle"
                          style={{ background: p.color }}
                        />
                        {p.name}
                      </Link>
                      <span className="font-mono text-slate-500">{p.total.toFixed(1)}h</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </>
      )}

      {/* Upcoming tasks */}
      <h2 className="mt-10 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Upcoming tasks
      </h2>
      <div className="card mt-3 divide-y divide-slate-100">
        {!meQ.data || meQ.data.upcomingTasks.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">Nothing on your plate. 👏</div>
        ) : (
          meQ.data.upcomingTasks.map((t) => (
            <Link
              key={t.id}
              to={`/tasks/${t.id}`}
              className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-800 truncate">{t.title}</div>
                <div className="text-xs text-slate-500">
                  {t.assignee ? (
                    <span>
                      Assigned by {t.creator?.fullName ?? '—'} ·{' '}
                      {t.dueDate ? `due ${formatDate(t.dueDate)}` : 'no due date'}
                    </span>
                  ) : (
                    <span>—</span>
                  )}
                </div>
              </div>
              <span className={STATUS_BADGE[t.status]}>{STATUS_LABELS[t.status]}</span>
            </Link>
          ))
        )}
      </div>

      {/* Recent logs */}
      <h2 className="mt-10 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Recent work logs
      </h2>
      <div className="card mt-3 divide-y divide-slate-100">
        {!meQ.data || meQ.data.recentLogs.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">No logs yet.</div>
        ) : (
          meQ.data.recentLogs.map((l) => (
            <div key={l.id} className="px-5 py-3 flex items-start gap-3">
              <Avatar name={l.project?.name ?? l.customer?.name ?? '—'} size="sm" className="bg-slate-100 text-slate-700" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-slate-800 truncate">
                  {l.project?.name ?? l.customer?.name ?? 'Ad-hoc activity'}{' '}
                  <span className="text-slate-400 font-normal">· {(l.hours ?? 0).toFixed(2)}h</span>
                </div>
                <div className="text-xs text-slate-500 line-clamp-1">{l.description || '—'}</div>
              </div>
              <div className="text-xs text-slate-400 flex-shrink-0">{fromNow(l.createdAt)}</div>
            </div>
          ))
        )}
      </div>
    </PageContainer>
  );
}

function StatCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: React.ReactNode;
}) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        {icon} {label}
      </div>
      <div className="mt-1 text-3xl font-bold text-slate-900">{value}</div>
      {hint && <div className="mt-2">{hint}</div>}
    </div>
  );
}
