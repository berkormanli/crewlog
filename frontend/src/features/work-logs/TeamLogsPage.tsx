import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, X, ChevronRight, Calendar, User, FolderKanban } from 'lucide-react';
import { workLogsApi, projectsApi, usersApi } from '@/api';
import { PageContainer, PageHeader, Avatar } from '@/components/Avatar';
import { Spinner } from '@/components/Spinner';
import { EmptyState } from '@/components/EmptyState';
import type { TeamSummary } from '@/types';
import { todayISODate, formatDate } from '@/lib/format';
import { apiBase } from '@/api/client';

function intensityClass(h: number): string {
  if (h === 0) return 'bg-slate-100';
  if (h < 2) return 'bg-emerald-200';
  if (h < 4) return 'bg-emerald-400';
  if (h < 8) return 'bg-emerald-600 text-white';
  return 'bg-emerald-800 text-white';
}

type DrillKind = 'worker' | 'project' | null;
interface Drill {
  kind: DrillKind;
  id: string;
  label: string;
}

export default function TeamLogsPage() {
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 14);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(todayISODate());
  const [projectId, setProjectId] = useState('');
  const [workerId, setWorkerId] = useState('');
  const [drill, setDrill] = useState<Drill | null>(null);

  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: projectsApi.list });
  const usersQ = useQuery({ queryKey: ['users-list'], queryFn: usersApi.list });

  const summaryQ = useQuery({
    queryKey: ['logs', 'team-summary', from, to, projectId, workerId],
    queryFn: () =>
      workLogsApi.teamSummary({
        from,
        to,
        project: projectId || undefined,
        worker: workerId || undefined,
      }),
  });

  function exportCsv() {
    const params = new URLSearchParams({ from, to });
    if (projectId) params.set('project', projectId);
    if (workerId) params.set('worker', workerId);
    const url = `${apiBase}/api/v1/work-logs/export.csv?${params.toString()}`;
    window.open(url, '_blank');
  }

  // Lookup maps for IDs → names
  const userMap = new Map((usersQ.data ?? []).map((u) => [u.id, u]));
  const projectMap = new Map((projectsQ.data ?? []).map((p) => [p.id, p]));

  return (
    <PageContainer>
      <PageHeader
        title="Team logs"
        subtitle="See how the team is spending time. Click CSV to export."
        actions={
          <button onClick={exportCsv} className="btn-secondary">
            <Download size={16} /> Export CSV
          </button>
        }
      />

      {/* Filters */}
      <div className="card p-4 mb-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <div>
          <label className="label">From</label>
          <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="label">To</label>
          <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div>
          <label className="label">Project</label>
          <select
            className="input"
            value={projectId}
            onChange={(e) => { setProjectId(e.target.value); setDrill(null); }}
          >
            <option value="">Any</option>
            {projectsQ.data?.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Worker</label>
          <select
            className="input"
            value={workerId}
            onChange={(e) => { setWorkerId(e.target.value); setDrill(null); }}
          >
            <option value="">Any</option>
            {usersQ.data?.map((u) => (
              <option key={u.id} value={u.id}>{u.fullName}</option>
            ))}
          </select>
        </div>
      </div>

      {summaryQ.isLoading ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm">
          <Spinner /> Loading summary…
        </div>
      ) : !summaryQ.data ? (
        <EmptyState title="No data" />
      ) : drill ? (
        <DrillDownView
          summary={summaryQ.data}
          drill={drill}
          onBack={() => setDrill(null)}
          projectMap={projectMap}
          userMap={userMap}
        />
      ) : (
        <TeamSummaryView
          summary={summaryQ.data}
          userMap={userMap}
          projectMap={projectMap}
          onSelectWorker={(id, label) => setDrill({ kind: 'worker', id, label })}
          onSelectProject={(id, label) => setDrill({ kind: 'project', id, label })}
        />
      )}
    </PageContainer>
  );
}

function TeamSummaryView({
  summary,
  userMap,
  projectMap,
  onSelectWorker,
  onSelectProject,
}: {
  summary: TeamSummary;
  userMap: Map<string, { id: string; fullName: string; avatarUrl: string | null }>;
  projectMap: Map<string, { id: string; name: string; code: string; color: string }>;
  onSelectWorker: (id: string, label: string) => void;
  onSelectProject: (id: string, label: string) => void;
}) {
  const totalsByWorker = summary.totalsByWorker ?? {};
  const totalsByProject = summary.totalsByProject ?? {};

  const days = (() => {
    const out: string[] = [];
    const start = new Date(summary.from + 'T00:00:00');
    const end = new Date(summary.to + 'T00:00:00');
    while (start <= end) {
      out.push(start.toISOString().slice(0, 10));
      start.setDate(start.getDate() + 1);
    }
    return out;
  })();

  const heatmapMap = new Map(summary.heatmap.map((h) => [h.date, h]));

  const topWorkers = Object.entries(totalsByWorker).sort((a, b) => b[1] - a[1]);
  const topProjects = Object.entries(totalsByProject).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-6">
      {/* Heatmap */}
      <div className="card p-5 overflow-x-auto">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Hours per day</h3>
        <div className="flex gap-1 min-w-fit">
          {days.map((d) => {
            const cell = heatmapMap.get(d);
            const total = cell?.total ?? 0;
            const tooltip = `${d}: ${total.toFixed(2)}h`;
            return (
              <div
                key={d}
                title={tooltip}
                className={`w-5 h-5 rounded-sm flex items-center justify-center text-[9px] ${intensityClass(total)}`}
              />
            );
          })}
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500 mt-3">
          Less
          <span className={`w-3 h-3 rounded-sm ${intensityClass(0)}`} />
          <span className={`w-3 h-3 rounded-sm ${intensityClass(1.5)}`} />
          <span className={`w-3 h-3 rounded-sm ${intensityClass(3)}`} />
          <span className={`w-3 h-3 rounded-sm ${intensityClass(6)}`} />
          <span className={`w-3 h-3 rounded-sm ${intensityClass(10)}`} />
          More
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-700">Top workers</h3>
            <span className="text-xs text-slate-400">click to drill down</span>
          </div>
          {topWorkers.length === 0 ? (
            <p className="text-sm text-slate-400">None yet.</p>
          ) : (
            <ol className="space-y-1">
              {topWorkers.map(([id, h], i) => {
                const u = userMap.get(id);
                return (
                  <li key={id}>
                    <button
                      onClick={() => onSelectWorker(id, u?.fullName ?? 'Unknown worker')}
                      className="w-full flex items-center gap-3 text-sm px-2 py-1.5 rounded-lg hover:bg-slate-50 transition group"
                    >
                      <span className="w-5 text-slate-400 font-mono text-right">{i + 1}.</span>
                      <Avatar name={u?.fullName ?? '—'} size="sm" src={u?.avatarUrl} />
                      <span className="text-slate-800 font-medium flex-1 text-left truncate">
                        {u?.fullName ?? 'Unknown worker'}
                      </span>
                      <span className="font-mono text-slate-700">{h.toFixed(2)}h</span>
                      <ChevronRight
                        size={14}
                        className="text-slate-300 group-hover:text-slate-500 transition"
                      />
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-700">Top projects</h3>
            <span className="text-xs text-slate-400">click to drill down</span>
          </div>
          {topProjects.length === 0 ? (
            <p className="text-sm text-slate-400">None yet.</p>
          ) : (
            <ol className="space-y-1">
              {topProjects.map(([id, h], i) => {
                const p = projectMap.get(id);
                return (
                  <li key={id}>
                    <button
                      onClick={() => onSelectProject(id, p?.name ?? 'Unknown project')}
                      className="w-full flex items-center gap-3 text-sm px-2 py-1.5 rounded-lg hover:bg-slate-50 transition group"
                    >
                      <span className="w-5 text-slate-400 font-mono text-right">{i + 1}.</span>
                      <span
                        className="w-3 h-3 rounded-sm flex-shrink-0"
                        style={{ background: p?.color ?? '#cbd5e1' }}
                      />
                      <span className="text-slate-800 font-medium flex-1 text-left truncate">
                        {p?.name ?? 'Unknown project'}
                      </span>
                      <span className="font-mono text-slate-700">{h.toFixed(2)}h</span>
                      <ChevronRight
                        size={14}
                        className="text-slate-300 group-hover:text-slate-500 transition"
                      />
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}

function DrillDownView({
  summary,
  drill,
  onBack,
  projectMap,
  userMap,
}: {
  summary: TeamSummary;
  drill: Drill;
  onBack: () => void;
  projectMap: Map<string, { id: string; name: string; code: string; color: string }>;
  userMap: Map<string, { id: string; fullName: string; avatarUrl: string | null }>;
}) {
  // Filter the rows to this drill
  const filteredRows = (summary.rows ?? []).filter((r: any) =>
    drill.kind === 'worker' ? r.worker?.id === drill.id : r.project?.id === drill.id
  );

  // Group by date
  const grouped = new Map<string, any[]>();
  for (const r of filteredRows) {
    const date = r.date;
    if (!grouped.has(date)) grouped.set(date, []);
    grouped.get(date)!.push(r);
  }
  const dates = Array.from(grouped.keys()).sort((a, b) => b.localeCompare(a));

  const total = filteredRows.reduce((s, r) => s + r.hours, 0);
  const dayCount = dates.length;
  const avg = dayCount > 0 ? total / dayCount : 0;
  const isWorker = drill.kind === 'worker';

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="flex items-start gap-3">
          <button
            onClick={onBack}
            className="btn-ghost text-sm flex-shrink-0"
            aria-label="Back to summary"
          >
            <X size={14} /> Back
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
              {isWorker ? <User size={14} /> : <FolderKanban size={14} />}
              <span className="uppercase tracking-wide">
                {isWorker ? 'Worker detail' : 'Project detail'}
              </span>
              <span className="text-slate-400">·</span>
              <span>
                {formatDate(summary.from)} → {formatDate(summary.to)}
              </span>
            </div>
            <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              {isWorker ? (
                <Avatar
                  name={drill.label}
                  size="md"
                  src={userMap.get(drill.id)?.avatarUrl ?? null}
                />
              ) : (
                <span
                  className="w-3 h-6 rounded-full"
                  style={{ background: projectMap.get(drill.id)?.color ?? '#cbd5e1' }}
                />
              )}
              {drill.label}
            </h2>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mt-5">
          <Stat label="Total hours" value={total.toFixed(2)} suffix="h" />
          <Stat label="Days worked" value={String(dayCount)} />
          <Stat label="Avg / day" value={avg.toFixed(2)} suffix="h" />
        </div>
      </div>

      {dates.length === 0 ? (
        <EmptyState
          title="No entries in this range"
          description="Try widening the date range or clearing filters."
        />
      ) : (
        <div className="space-y-3">
          {dates.map((date) => {
            const items = grouped.get(date)!;
            const dayTotal = items.reduce((s, r) => s + r.hours, 0);
            return (
              <div key={date} className="card overflow-hidden">
                <div className="px-5 py-2 bg-slate-50 flex items-center justify-between">
                  <div className="text-sm text-slate-700 font-medium flex items-center gap-2">
                    <Calendar size={14} className="text-slate-400" />
                    {new Date(date + 'T00:00:00').toLocaleDateString(undefined, {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </div>
                  <div className="font-mono text-sm text-brand-700">{dayTotal.toFixed(2)}h</div>
                </div>
                <ul className="divide-y divide-slate-100">
                  {items.map((r: any, i: number) => (
                    <li key={i} className="px-5 py-3 flex items-start gap-3">
                      {isWorker ? (
                        <span
                          className="w-3 h-3 rounded-full mt-1.5 flex-shrink-0"
                          style={{ background: r.project?.color ?? '#cbd5e1' }}
                        />
                      ) : (
                        <Avatar
                          name={r.worker?.fullName ?? '—'}
                          size="sm"
                          src={r.worker?.avatarUrl ?? null}
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-sm">
                          {isWorker ? (
                            <span className="font-medium text-slate-800">
                              {r.project?.name ?? '—'}
                            </span>
                          ) : (
                            <span className="font-medium text-slate-800">
                              {r.worker?.fullName ?? '—'}
                            </span>
                          )}
                          {r.task && (
                            <span className="text-slate-500"> → {r.task}</span>
                          )}
                        </div>
                        {r.description && (
                          <p className="text-xs text-slate-600 mt-1 whitespace-pre-wrap line-clamp-3">
                            {r.description}
                          </p>
                        )}
                      </div>
                      <div className="font-mono text-sm text-brand-700 flex-shrink-0">
                        {r.hours.toFixed(2)}h
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, suffix }: { label: string; value: string; suffix?: string }) {
  return (
    <div className="bg-slate-50 rounded-lg p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-0.5 text-2xl font-bold text-slate-900">
        {value}
        {suffix && <span className="text-base font-normal text-slate-500 ml-0.5">{suffix}</span>}
      </div>
    </div>
  );
}
