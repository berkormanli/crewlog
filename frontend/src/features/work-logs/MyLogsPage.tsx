import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, ClipboardList, Clock, Cog, MapPin, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { workLogsApi } from '@/api';
import { PageContainer, PageHeader } from '@/components/Avatar';
import { Spinner } from '@/components/Spinner';
import { EmptyState } from '@/components/EmptyState';
import { fromNow, todayISODate } from '@/lib/format';
import { useAuthStore } from '@/stores/auth';
import type { WorkLog } from '@/types';

/**
 * Read-only history of the worker's own logs. For editing, jump to the
 * selected-day Timesheet (/logs/timesheet) which has inline editors.
 */
export default function MyLogsPage() {
  const qc = useQueryClient();
  const backdateWindowDays = useAuthStore((s) => s.settings.backdateWindowDays);
  const [pageDate, setPageDate] = useState(() => new Date().toISOString().slice(0, 10));

  const from = useMemo(() => {
    const d = new Date(pageDate);
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  }, [pageDate]);
  const to = useMemo(() => {
    const d = new Date(pageDate);
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  }, [pageDate]);

  const logsQ = useQuery({
    queryKey: ['logs', { from, to }],
    queryFn: () => workLogsApi.list({ from, to }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => workLogsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['logs'] });
      qc.invalidateQueries({ queryKey: ['timesheet'] });
      toast.success('Deleted');
    },
    onError: (e: any) => toast.error(e?.message ?? 'Failed'),
  });

  const grouped = useMemo(() => {
    const map = new Map<string, WorkLog[]>();
    (logsQ.data?.items ?? []).forEach((l) => {
      map.set(l.date, [...(map.get(l.date) ?? []), l]);
    });
    return Array.from(map.entries()).sort(([a], [b]) => b.localeCompare(a));
  }, [logsQ.data]);

  const month = pageDate.slice(0, 7);

  return (
    <PageContainer>
      <PageHeader
        title="My logs"
        subtitle="Read-only history. Edit entries on the Timesheet."
        actions={
          <Link to="/logs/timesheet" className="btn-primary">
            <Clock size={14} /> Open Timesheet
          </Link>
        }
      />

      <div className="card p-4 mb-4 flex items-center gap-4">
        <button
          className="btn-ghost"
          onClick={() => {
            const d = new Date(pageDate);
            d.setMonth(d.getMonth() - 1);
            setPageDate(d.toISOString().slice(0, 10));
          }}
          aria-label="Previous month"
        >
          <ChevronLeft size={18} />
        </button>
        <div className="font-semibold text-slate-700">
          {new Date(pageDate + 'T00:00:00').toLocaleDateString(undefined, {
            month: 'long',
            year: 'numeric',
          })}
        </div>
        <button
          className="btn-ghost"
          onClick={() => {
            const d = new Date(pageDate);
            d.setMonth(d.getMonth() + 1);
            setPageDate(d.toISOString().slice(0, 10));
          }}
          aria-label="Next month"
        >
          <ChevronRight size={18} />
        </button>
        <div className="ml-auto">
          <input
            type="month"
            className="input"
            value={month}
            onChange={(e) =>
              setPageDate(e.target.value + '-01')
            }
          />
        </div>
      </div>

      {logsQ.isLoading ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm">
          <Spinner /> Loading…
        </div>
      ) : grouped.length === 0 ? (
        <EmptyState
          title="No logs in this window"
          description="Try a different month, or jump to the Timesheet to log some time."
        />
      ) : (
        <div className="space-y-4">
          {grouped.map(([date, items]) => {
            const total = items.reduce((s, x) => s + (x.hours ?? 0), 0);
            return (
              <div key={date} className="card overflow-hidden">
                <div className="px-5 py-2 bg-slate-50 flex items-center justify-between">
                  <div className="text-sm text-slate-700 font-medium">
                    {new Date(date + 'T00:00:00').toLocaleDateString(undefined, {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </div>
                  <div className="font-mono text-sm text-brand-700">{total.toFixed(2)}h</div>
                </div>
                <div className="divide-y divide-slate-100">
                  {items.map((l) => {
                    // Out-of-window entries have delete disabled because the
                    // server enforces the limit too — surfacing a button we
                    // know will 403 just wastes a click.
                    const today = todayISODate();
                    const minD = new Date(today + 'T00:00:00');
                    minD.setDate(minD.getDate() - backdateWindowDays);
                    const minIso = minD.toISOString().slice(0, 10);
                    const editable = l.date >= minIso && l.date <= today;
                    return (
                      <Row
                        key={l.id}
                        log={l}
                        editable={editable}
                        backdateWindowDays={backdateWindowDays}
                        onDelete={() => deleteMut.mutate(l.id)}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </PageContainer>
  );
}

function Row({
  log,
  onDelete,
  editable,
  backdateWindowDays,
}: {
  log: WorkLog;
  onDelete: () => void;
  editable: boolean;
  backdateWindowDays: number;
}) {
  return (
    <div className="px-5 py-3 flex items-start gap-3">
      <span
        className="w-3 h-3 rounded-full mt-1.5 flex-shrink-0"
        style={{ background: log.project?.color ?? '#cbd5e1' }}
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm">
          {!log.project && !log.customer ? (
            <span className="italic text-slate-500">Ad-hoc activity</span>
          ) : (
            <span className="font-medium text-slate-800">{log.project?.name ?? '—'}</span>
          )}
          {log.customer && <span className="text-slate-500"> · {log.customer.name}</span>}
          {log.task && <span className="text-slate-500"> → {log.task.title}</span>}
          <span className="ml-2 font-mono text-brand-700">{(log.hours ?? 0).toFixed(2)}h</span>
          {log.startTime && log.endTime && (
            <span className="ml-2 text-xs text-slate-500 font-mono">
              {log.startTime}–{log.endTime}
            </span>
          )}
        </div>
        {(log.module || log.activityType || log.location) && (
          <div className="text-xs text-slate-500 mt-1 flex flex-wrap gap-x-3 gap-y-1">
            {log.module && (
              <span className="inline-flex items-center gap-1">
                <Cog size={11} /> {log.moduleOther || log.module}
              </span>
            )}
            {log.activityType && (
              <span className="inline-flex items-center gap-1">
                <ClipboardList size={11} /> {log.activityTypeOther || log.activityType}
              </span>
            )}
            {log.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin size={11} /> {log.locationOther || log.location}
              </span>
            )}
          </div>
        )}
        {log.description && (
          <p className="text-sm text-slate-600 mt-1 whitespace-pre-wrap line-clamp-3">{log.description}</p>
        )}
        <div className="text-xs text-slate-400 mt-1">
          Added {fromNow(log.createdAt)}
          {!editable && (
            <span className="ml-2 inline-flex items-center gap-1 text-amber-600">
              · outside the {backdateWindowDays}-day window
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {editable ? (
          <button
            className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50"
            onClick={() => {
              if (confirm('Delete this log entry?')) onDelete();
            }}
            aria-label="Delete"
          >
            <Trash2 size={16} />
          </button>
        ) : (
          <button
            className="p-1.5 rounded text-slate-200 cursor-not-allowed"
            disabled
            aria-label="Delete (locked)"
            title={`This entry is outside your ${backdateWindowDays}-day edit window. Ask a manager to remove it.`}
            onClick={(e) => {
              e.preventDefault();
              toast.error(
                `This entry is outside your ${backdateWindowDays}-day edit window. Ask a manager to remove it.`
              );
            }}
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
