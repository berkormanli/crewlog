import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Calendar,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  Cog,
  MapPin,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import {
  customersApi,
  projectsApi,
  tasksApi,
  usersApi,
  workActivityTypesApi,
  workLocationsApi,
  workLogsApi,
  workModulesApi,
} from '@/api';
import { PageContainer, PageHeader } from '@/components/Avatar';
import { EmptyState } from '@/components/EmptyState';
import { Modal } from '@/components/Modal';
import { Spinner } from '@/components/Spinner';
import { canManage } from '@/lib/rbac';
import { fromNow, todayISODate } from '@/lib/format';
import { useAuthStore } from '@/stores/auth';
import type { LookupOption, Timesheet, TimesheetRow, WorkLog } from '@/types';
import { LOOKUP_OTHER } from '@/types';

// ---- Date helpers ----

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function startOfWeek(iso: string, weekStartsOn: 0 | 1 = 1): string {
  const d = new Date(iso + 'T00:00:00');
  const day = d.getDay();
  const diff = (day - weekStartsOn + 7) % 7;
  d.setDate(d.getDate() - diff);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function endOfWeek(iso: string, weekStartsOn: 0 | 1 = 1): string {
  return addDays(startOfWeek(iso, weekStartsOn), 6);
}

function monthString(iso: string): string {
  return iso.slice(0, 7); // YYYY-MM
}

function startOfMonth(month: string): Date {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1);
}

function addMonths(month: string, n: number): string {
  const d = startOfMonth(month);
  d.setMonth(d.getMonth() + n);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

function isWeekendDow(dow: number): boolean {
  return dow === 0 || dow === 6;
}

function isWeekendIso(iso: string): boolean {
  return isWeekendDow(new Date(iso + 'T00:00:00').getDay());
}

// ---- Time formatting ----

function formatHm(hours: number | null | undefined): string {
  // TimeCamp-style: "Xh YYm" (rounded to minute precision).
  const h = Number(hours ?? 0);
  const totalMinutes = Math.round(h * 60);
  const hh = Math.floor(totalMinutes / 60);
  const mm = totalMinutes % 60;
  return `${hh}h ${String(mm).padStart(2, '0')}m`;
}

// Note: time-of-day formatting is used by the edit modal.
function formatTimeOfDay(t: string | null | undefined): string {
  if (!t) return '';
  // Postgres TIME comes back as full "HH:MM:SS" — trim to HH:MM.
  return t.slice(0, 5);
}

function computeHoursFromWindow(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const total = eh * 60 + em - (sh * 60 + sm);
  if (total <= 0) return null;
  return Math.round((total / 60) * 4) / 4;
}

const TIME_OPTIONS = Array.from({ length: 96 }, (_, index) => {
  const totalMinutes = index * 15;
  const hours = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
  const minutes = String(totalMinutes % 60).padStart(2, '0');
  return `${hours}:${minutes}`;
});

function defaultTimeWindow(): { start: string; end: string } {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  // Use the most recent quarter hour. Keep a valid one-hour window around
  // midnight and never emit 24:00 (Postgres TIME accepts up to 23:59).
  const endMinutes = Math.max(15, Math.min(23 * 60 + 45, Math.floor(currentMinutes / 15) * 15));
  const startMinutes = Math.max(0, endMinutes - 60);
  const format = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  return { start: format(startMinutes), end: format(endMinutes) };
}

// ---- Component ----

export default function TimesheetPage() {
  const user = useAuthStore((s) => s.user)!;
  const role = user.role;
  const isManager = canManage(role);

  // Removed the Week view per the colleague call. We keep Day + Calendar.
  type View = 'day' | 'calendar';
  const [view, setView] = useState<View>('day');

  const [pivotDate, setPivotDate] = useState<string>(() => todayISODate());
  const [workerId, setWorkerId] = useState<string>(user.id);

  useEffect(() => {
    setWorkerId(user.id);
    setPivotDate(todayISODate());
  }, [user.id]);

  const weekStart = useMemo(() => startOfWeek(pivotDate, 1), [pivotDate]);
  const weekEnd = useMemo(() => endOfWeek(pivotDate, 1), [pivotDate]);
  const month = monthString(pivotDate);

  const timesheetQ = useQuery({
    queryKey: ['timesheet', { from: weekStart, to: weekEnd, worker: workerId }],
    queryFn: () => workLogsApi.timesheet({ from: weekStart, to: weekEnd, worker: workerId }),
    enabled: view === 'day',
  });

  const calendarQ = useQuery({
    queryKey: ['calendar', { month, worker: workerId }],
    queryFn: () => workLogsApi.calendar({ month, worker: workerId }),
    enabled: view === 'calendar',
  });

  const usersQ = useQuery({
    queryKey: ['users-list'],
    queryFn: usersApi.list,
    enabled: isManager,
  });

  const ts = timesheetQ.data;

  const rangeLabel = useMemo(() => {
    if (view === 'day') {
      const d = new Date(pivotDate + 'T00:00:00');
      return d.toLocaleDateString(undefined, { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' });
    }
    const d = startOfMonth(month);
    return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }, [view, pivotDate, month]);

  return (
    <PageContainer>
      <PageHeader
        title="Timesheet"
        subtitle={
          <span>
            <span className="font-medium text-slate-700">{rangeLabel}</span>
            {ts && (
              <span className="ml-3 text-slate-400">
                · {ts.worker.fullName} · backdate window {ts.backdateWindowDays}d
                {ts.worker.timezone && (
                  <span className="ml-2">· {ts.worker.timezone}</span>
                )}
              </span>
            )}
          </span>
        }
        actions={
          <ViewSwitcher view={view} onChange={setView} />
        }
      />

      {/* Toolbar */}
      <div className="card p-4 mb-4 flex flex-wrap items-center gap-3">
        <DateNav
          view={view}
          pivotDate={pivotDate}
          setPivotDate={setPivotDate}
        />

        {isManager && (
          <div className="flex items-center gap-2 ml-2">
            <span className="text-xs text-slate-500">Viewing</span>
            <select
              className="input py-1.5 max-w-[260px]"
              value={workerId}
              onChange={(e) => setWorkerId(e.target.value)}
            >
              {(usersQ.data ?? [])
                .filter((u) => u.isActive)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName} ({u.role})
                  </option>
                ))}
            </select>
          </div>
        )}
      </div>

      {/* Summary cards: actual activity only; no target/expected-hours metrics. */}
      {view === 'day' && ts && <SummaryCards timesheet={ts} date={pivotDate} />}

      {/* View body */}
      {view === 'day' && (
        timesheetQ.isLoading ? (
          <div className="card p-8 flex items-center gap-2 text-slate-500 text-sm">
            <Spinner /> Loading timesheet…
          </div>
        ) : !ts ? (
          <EmptyState title="No data" />
        ) : (
          <DayView timesheet={ts} pivotDate={pivotDate} />
        )
      )}

      {view === 'calendar' && (
        calendarQ.isLoading ? (
          <div className="card p-8 flex items-center gap-2 text-slate-500 text-sm">
            <Spinner /> Loading calendar…
          </div>
        ) : !calendarQ.data ? (
          <EmptyState title="No data" />
        ) : (
          <CalendarView data={calendarQ.data} onPickDay={(d) => { setPivotDate(d); setView('day'); }} />
        )
      )}

      {/* Entries list (only for day view) */}
      {view === 'day' && ts && ts.rows.length > 0 && (() => {
        const pivot = pivotDate;
        const dayTs: Timesheet = {
          ...ts,
          days: [pivot],
          dayExpected: { [pivot]: ts.dayExpected[pivot] ?? 0 },
          dayTotals: { [pivot]: ts.dayTotals[pivot] ?? 0 },
          dayCompletion: { [pivot]: ts.dayCompletion[pivot] ?? 0 },
          rows: ts.rows
            .filter((r) => (r.dayHours[pivot] ?? 0) > 0)
            .map((r) => ({
              ...r,
              dayHours: { [pivot]: r.dayHours[pivot] ?? 0 },
              total: r.dayHours[pivot] ?? 0,
              entries: r.entries.filter((e) => e.date === pivot),
            })),
          from: pivot,
          to: pivot,
          grandTotal: ts.dayTotals[pivot] ?? 0,
        };
        return (
          <div className="card overflow-hidden mb-6">
            <EntriesBlock timesheet={dayTs} variant="day" />
          </div>
        );
      })()}
    </PageContainer>
  );
}

// ---------- View switcher (Day + Calendar only — Week removed) ----------

function ViewSwitcher({ view, onChange }: { view: 'day' | 'calendar'; onChange: (v: 'day' | 'calendar') => void }) {
  const opts: Array<{ id: 'day' | 'calendar'; label: string; icon: any }> = [
    { id: 'day', label: 'Day', icon: Clock },
    { id: 'calendar', label: 'Calendar', icon: CalendarRange },
  ];
  return (
    <div className="card flex items-center p-1 gap-1">
      {opts.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={clsx(
            'px-3 py-1 text-sm rounded-md transition inline-flex items-center gap-1.5',
            view === o.id ? 'bg-slate-100 text-slate-900 font-medium' : 'text-slate-600 hover:bg-slate-50'
          )}
        >
          <o.icon size={14} />
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- Date navigation ----------

function DateNav({
  view,
  pivotDate,
  setPivotDate,
}: {
  view: 'day' | 'calendar';
  pivotDate: string;
  setPivotDate: (d: string) => void;
}) {
  const go = (n: number) => {
    if (view === 'day') setPivotDate(addDays(pivotDate, n));
    else setPivotDate(addMonths(monthString(pivotDate), n) + '-01');
  };

  const jumpToToday = () => setPivotDate(todayISODate());
  const todayLabel = view === 'day' ? 'Today' : 'This month';

  return (
    <div className="flex items-center gap-2">
      <button className="btn-ghost p-1.5" onClick={() => go(-1)} aria-label={`Previous ${view}`}>
        <ChevronLeft size={18} />
      </button>
      <button className="btn-ghost text-sm" onClick={jumpToToday}>
        <CalendarRange size={14} /> {todayLabel}
      </button>
      <button className="btn-ghost p-1.5" onClick={() => go(1)} aria-label={`Next ${view}`}>
        <ChevronRight size={18} />
      </button>

      {view === 'day' && (
        <input
          type="date"
          className="input py-1.5 w-[160px] ml-1"
          value={pivotDate}
          onChange={(e) => setPivotDate(e.target.value)}
        />
      )}
      {view === 'calendar' && (
        <input
          type="month"
          className="input py-1.5 w-[160px] ml-1"
          value={pivotDate.slice(0, 7)}
          onChange={(e) => setPivotDate(`${e.target.value}-01`)}
        />
      )}
    </div>
  );
}

// ---------- Summary cards ----------

function SummaryCards({ timesheet, date }: { timesheet: Timesheet; date: string }) {
  const entries = timesheet.rows.flatMap((row) => row.entries).filter((entry) => entry.date === date);
  const totalLogged = timesheet.dayTotals[date] ?? 0;
  const starts = entries.map((entry) => formatTimeOfDay(entry.startTime)).filter(Boolean).sort();
  const ends = entries.map((entry) => formatTimeOfDay(entry.endTime)).filter(Boolean).sort();
  const isToday = date === todayISODate();

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      <SummaryStat
        icon={<Clock size={16} className="text-brand-600" />}
        label={isToday ? 'Logged today' : 'Logged selected day'}
        value={formatHm(totalLogged)}
        sub={<span className="text-xs text-slate-500">Actual recorded effort</span>}
      />
      <SummaryStat
        icon={<ClipboardList size={16} className="text-emerald-600" />}
        label="Activities"
        value={entries.length}
        sub={<span className="text-xs text-slate-500">Entries on this day</span>}
      />
      <SummaryStat
        icon={<Calendar size={16} className="text-violet-600" />}
        label="First start"
        value={starts[0] ?? '—'}
        sub={<span className="text-xs text-slate-500">From detailed time ranges</span>}
      />
      <SummaryStat
        icon={<Clock size={16} className="text-amber-600" />}
        label="Last end"
        value={ends.at(-1) ?? '—'}
        sub={<span className="text-xs text-slate-500">From detailed time ranges</span>}
      />
    </div>
  );
}

// ---------- Day view ----------

function DayView({ timesheet, pivotDate }: { timesheet: Timesheet; pivotDate: string }) {
  const dow = new Date(pivotDate + 'T00:00:00').getDay();
  if (!timesheet.days.includes(pivotDate)) {
    return (
      <div className="card p-6 text-sm text-slate-500">
        Day is outside the loaded week ({timesheet.from} → {timesheet.to}). Go back via the date picker.
      </div>
    );
  }

  const dayTs: Timesheet = {
    ...timesheet,
    days: [pivotDate],
    dayExpected: { [pivotDate]: timesheet.dayExpected[pivotDate] ?? 0 },
    dayTotals: { [pivotDate]: timesheet.dayTotals[pivotDate] ?? 0 },
    dayCompletion: { [pivotDate]: timesheet.dayCompletion[pivotDate] ?? 0 },
    rows: timesheet.rows.map((r) => ({
      ...r,
      dayHours: { [pivotDate]: r.dayHours[pivotDate] ?? 0 },
      total: r.dayHours[pivotDate] ?? 0,
    })),
    from: pivotDate,
    to: pivotDate,
    grandTotal: timesheet.dayTotals[pivotDate] ?? 0,
  };

  const weekend = isWeekendDow(dow);

  return (
    <div className="card overflow-hidden mb-6">
      <div className={clsx('px-5 py-3 border-b border-slate-100 flex items-center gap-3', weekend && 'bg-amber-50/60')}>
        <h2 className="text-base font-semibold text-slate-800">
          {new Date(pivotDate + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long' })}
        </h2>
        {weekend && (
          <span className="badge bg-amber-100 text-amber-800">Weekend day</span>
        )}
        <span className="text-xs text-slate-400 ml-auto">Use the "Log activity" button to record time.</span>
      </div>
      <DayGrid timesheet={dayTs} weekend={weekend} />
    </div>
  );
}

// ---------- Day grid (single-day list of activity rows) ----------

function DayGrid({ timesheet, weekend }: { timesheet: Timesheet; weekend: boolean }) {
  const qc = useQueryClient();
  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: projectsApi.list });
  const customersQ = useQuery({ queryKey: ['customers-list'], queryFn: () => customersApi.list() });
  const tasksQ = useQuery({ queryKey: ['tasks-my'], queryFn: () => tasksApi.list({}) });
  const modulesQ = useQuery({ queryKey: ['work-modules'], queryFn: workModulesApi.list });
  const activityTypesQ = useQuery({ queryKey: ['work-activity-types'], queryFn: workActivityTypesApi.list });
  const locationsQ = useQuery({ queryKey: ['work-locations'], queryFn: workLocationsApi.list });

  const tasksByProject = useMemo(() => {
    const m = new Map<string, any[]>();
    (tasksQ.data ?? []).forEach((t) => {
      const arr = m.get(t.projectId) ?? [];
      arr.push(t);
      m.set(t.projectId, arr);
    });
    return m;
  }, [tasksQ.data]);

  const upsert = useMutation({
    mutationFn: async (vals: WorkLogCreatePayload) => workLogsApi.create(vals),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['timesheet'] });
      qc.invalidateQueries({ queryKey: ['calendar'] });
      qc.invalidateQueries({ queryKey: ['logs'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Activity logged');
    },
    onError: (e: any) => toast.error(e?.message ?? 'Failed to save'),
  });

  return (
    <div className={clsx(weekend && 'bg-amber-50/30')}>
      <div className="divide-y divide-slate-100">
        <div className="px-5 py-4">
          <NewWorkLogModal
            onClose={() => {}}
            projects={projectsQ.data ?? []}
            customers={customersQ.data ?? []}
            tasksByProject={tasksByProject}
            modules={modulesQ.data ?? []}
            activityTypes={activityTypesQ.data ?? []}
            locations={locationsQ.data ?? []}
            today={timesheet.today}
            backdateWindowDays={timesheet.backdateWindowDays}
            preferredDate={timesheet.days[0]}
            asInlineButton
            onSubmit={(vals) => upsert.mutateAsync(vals).then(() => undefined)}
          />
        </div>
        {timesheet.rows
          .filter((r) => (r.total ?? 0) > 0)
          .map((row) => (
            <DayRow key={row.key} row={row} />
          ))}
      </div>
    </div>
  );
}

function DayRow({ row }: { row: TimesheetRow }) {
  return (
    <div className="px-5 py-3">
      <div className="flex items-center gap-2 min-w-0">
        {row.adHoc ? (
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-slate-300" />
        ) : (
          <span
            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{ background: row.project?.color ?? '#cbd5e1' }}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm text-slate-800 truncate">
            {row.adHoc ? (
              <span className="italic text-slate-500">Ad-hoc activity</span>
            ) : (
              <>
                {row.project?.name ?? '—'}
                {row.customer && (
                  <span className="text-slate-500"> · {row.customer.name}</span>
                )}
                {row.task && <span className="text-slate-500"> → {row.task.title}</span>}
              </>
            )}
          </div>
        </div>
        <div className="font-mono text-sm text-slate-700">{formatHm(row.total)}</div>
      </div>
    </div>
  );
}

// ---------- Calendar view ----------

type CalendarDay = {
  date: string;
  logged: number;
  expected: number;
  ratio: number;
  inMonth: boolean;
};

function CalendarView({
  data,
  onPickDay,
}: {
  data: {
    month: string;
    from: string;
    to: string;
    today: string;
    weeks: Array<{ weekStart: string; days: CalendarDay[] }>;
  };
  onPickDay: (date: string) => void;
}) {
  const inMonthDays = data.weeks.flatMap((w) => w.days).filter((d) => d.inMonth);
  const activeDays = inMonthDays.filter((d) => d.logged > 0);
  const totalLogged = inMonthDays.reduce((sum, day) => sum + day.logged, 0);
  const weekendLogged = inMonthDays
    .filter((day) => isWeekendIso(day.date))
    .reduce((sum, day) => sum + day.logged, 0);
  const averagePerActiveDay = activeDays.length > 0 ? totalLogged / activeDays.length : 0;

  return (
    <div className="card overflow-hidden mb-6">
      {/* Summary */}
      <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center gap-4">
        <div>
          <div className="text-xs text-slate-500 uppercase tracking-wide">Month total</div>
          <div className="text-2xl font-bold text-slate-900">{formatHm(totalLogged)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500 uppercase tracking-wide">Active days</div>
          <div className="text-2xl font-bold text-slate-700">{activeDays.length}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500 uppercase tracking-wide">Average / active day</div>
          <div className="text-2xl font-bold text-slate-900">{formatHm(averagePerActiveDay)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500 uppercase tracking-wide">Weekend logged</div>
          <div className="text-2xl font-bold text-amber-700">{formatHm(weekendLogged)}</div>
        </div>
        <div className="ml-auto text-xs text-slate-400">
          Click any day to jump to its day view.
        </div>
      </div>

      {/* Day-of-week header */}
      <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => {
          const weekend = isWeekendDow(i === 6 ? 0 : i + 1);
          return (
            <div
              key={d}
              className={clsx(
                'px-2 py-2 text-center font-medium',
                weekend && !['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(d) && 'bg-amber-50/40 text-amber-800'
              )}
            >
              {d}
            </div>
          );
        })}
      </div>

      {/* Weeks */}
      <div>
        {data.weeks.map((w) => (
          <div key={w.weekStart} className="grid grid-cols-7 border-b border-slate-100 last:border-b-0">
            {w.days.map((day) => {
              const dow = new Date(day.date + 'T00:00:00').getDay();
              const weekend = isWeekendDow(dow);
              const isToday = day.date === data.today;
              return (
                <CalendarCell
                  key={day.date}
                  day={day}
                  weekend={weekend}
                  isToday={isToday}
                  onPick={onPickDay}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function CalendarCell({
  day,
  weekend,
  isToday,
  onPick,
}: {
  day: CalendarDay;
  weekend: boolean;
  isToday: boolean;
  onPick: (d: string) => void;
}) {
  const color = weekend ? 'bg-amber-400' : 'bg-brand-500';
  const dayNum = Number(day.date.slice(8));

  return (
    <button
      onClick={() => onPick(day.date)}
      className={clsx(
        'h-24 px-2 py-1.5 text-left flex flex-col gap-1 border-r border-slate-100 last:border-r-0 transition',
        !day.inMonth && 'bg-slate-50/60 text-slate-300',
        day.inMonth && !weekend && 'hover:bg-slate-50',
        day.inMonth && weekend && 'bg-amber-50/40 hover:bg-amber-50/70',
        isToday && 'ring-2 ring-inset ring-brand-400'
      )}
      title={`${day.date}: ${formatHm(day.logged)} logged`}
    >
      <div className="flex items-center justify-between">
        <span
          className={clsx(
            'text-xs font-medium',
            isToday && 'text-brand-700',
            !isToday && day.inMonth && weekend && 'text-amber-800',
            !isToday && day.inMonth && !weekend && 'text-slate-700',
            !day.inMonth && 'text-slate-300'
          )}
        >
          {dayNum}
        </span>
        {isToday && <span className="text-[9px] uppercase text-brand-700 font-semibold">today</span>}
      </div>

      {day.inMonth && day.logged > 0 ? (
        <>
          <div
            className={clsx(
              'text-sm font-mono font-semibold',
              weekend ? 'text-amber-700' : 'text-slate-800'
            )}
          >
            {formatHm(day.logged)}
          </div>
          <div className="mt-auto flex items-center gap-1">
            <div className="h-1.5 flex-1 rounded-full bg-slate-200 overflow-hidden">
              <div className={clsx('h-full transition-all', color)} style={{ width: '100%' }} />
            </div>
            <span className={clsx('text-[10px]', weekend ? 'text-amber-700' : 'text-slate-400')}>
              {weekend ? 'weekend' : 'logged'}
            </span>
          </div>
        </>
      ) : (
        day.inMonth && <div className="text-[10px] text-slate-300 mt-auto">No activity</div>
      )}
    </button>
  );
}

// ---------- Entries block (below the grid) ----------

/**
 * Can the current viewer edit / delete this entry?
 *  - Manager / admin: yes, always.
 *  - Worker: only their own entry AND only if the work date is within the
 *    backdate window (today - windowDays .. today). Older entries are locked
 *    so the UI hides the action buttons up front.
 */
function isEntryEditable(
  entry: WorkLog,
  viewerId: string,
  viewerRole: 'worker' | 'manager' | 'admin',
  backdateWindowDays: number
): boolean {
  if (canManage(viewerRole)) return true;
  if (entry.workerId !== viewerId) return false;
  const today = todayISODate();
  const d = new Date(today + 'T00:00:00');
  d.setDate(d.getDate() - backdateWindowDays);
  const minIso = d.toISOString().slice(0, 10);
  return entry.date >= minIso && entry.date <= today;
}

function EntriesBlock({ timesheet, variant }: { timesheet: Timesheet; variant: 'day' }) {
  const user = useAuthStore((s) => s.user)!;
  const [editing, setEditing] = useState<WorkLog | null>(null);

  const allEntries = timesheet.rows
    .flatMap((r) =>
      r.entries.map((e) => ({
        ...e,
        project: r.project ?? undefined,
        customer: r.customer ?? undefined,
        task: r.task ?? null,
        adHoc: r.adHoc,
      }))
    )
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));

  const groupedByDate = new Map<string, typeof allEntries>();
  for (const e of allEntries) {
    const arr = groupedByDate.get(e.date) ?? [];
    arr.push(e);
    groupedByDate.set(e.date, arr);
  }

  if (allEntries.length === 0) return null;

  return (
    <div className="border-t border-slate-200">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 px-5 py-3">
        {variant === 'day' ? 'Entries' : 'Entries in range'}
      </h3>
      <div className="divide-y divide-slate-100">
        {Array.from(groupedByDate.entries()).map(([date, items]) => {
          const dayTotal = items.reduce((sum, entry) => sum + (entry.hours ?? 0), 0);
          return (
            <div key={date}>
              <div className="px-5 py-2 bg-slate-50 flex items-center justify-between">
                <div className="text-sm text-slate-700 font-medium">
                  {new Date(date + 'T00:00:00').toLocaleDateString(undefined, {
                    weekday: 'long',
                    month: 'short',
                    day: 'numeric',
                  })}
                </div>
                <div className="font-mono text-sm text-brand-700">
                  Logged {formatHm(dayTotal)}
                </div>
              </div>
              <ul>
                {items.map((e) => {
                  const editable = isEntryEditable(e, user.id, user.role, timesheet.backdateWindowDays);
                  return (
                  <li key={e.id} className="px-5 py-3 flex items-start gap-3">
                    <span
                      className={clsx(
                        'w-3 h-3 rounded-full mt-1.5 flex-shrink-0',
                        e.adHoc ? 'bg-slate-300' : ''
                      )}
                      style={e.adHoc ? undefined : { background: e.project?.color ?? '#cbd5e1' }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm">
                        {e.adHoc ? (
                          <span className="italic text-slate-500">Ad-hoc activity</span>
                        ) : (
                          <span className="font-medium text-slate-800">{e.project?.name ?? '—'}</span>
                        )}
                        {e.customer && (
                          <span className="text-slate-500"> · {e.customer.name}</span>
                        )}
                        {e.task && <span className="text-slate-500"> → {e.task.title}</span>}
                        <span className="ml-2 font-mono text-brand-700">{formatHm(e.hours)}</span>
                        {e.startTime && e.endTime && (
                          <span className="ml-2 text-xs text-slate-500 font-mono">
                            {e.startTime}–{e.endTime}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap gap-x-3 gap-y-1">
                        {e.module && (
                          <span className="inline-flex items-center gap-1">
                            <Cog size={11} /> {e.moduleOther ? e.moduleOther : e.module}
                          </span>
                        )}
                        {e.activityType && (
                          <span className="inline-flex items-center gap-1">
                            <ClipboardList size={11} /> {e.activityTypeOther ? e.activityTypeOther : e.activityType}
                          </span>
                        )}
                        {e.location && (
                          <span className="inline-flex items-center gap-1">
                            <MapPin size={11} /> {e.locationOther ? e.locationOther : e.location}
                          </span>
                        )}
                      </div>
                      {e.description && (
                        <p className="text-sm text-slate-600 mt-1 whitespace-pre-wrap">{e.description}</p>
                      )}
                      <div className="text-xs text-slate-400 mt-1">
                        Added {fromNow(e.createdAt)}
                        {!editable && (
                          <span className="ml-2 inline-flex items-center gap-1 text-amber-600">
                            · outside the {timesheet.backdateWindowDays}-day window
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        className={clsx(
                          'p-1.5 rounded',
                          editable
                            ? 'text-slate-400 hover:text-brand-600 hover:bg-brand-50'
                            : 'text-slate-200 cursor-not-allowed'
                        )}
                        onClick={() => editable && setEditing(e)}
                        disabled={!editable}
                        aria-label="Edit"
                        title={
                          editable
                            ? 'Edit'
                            : `Outside the ${timesheet.backdateWindowDays}-day edit window`
                        }
                      >
                        <Pencil size={14} />
                      </button>
                      <DeleteLogButton
                        logId={e.id}
                        disabled={!editable}
                        disabledReason={
                          editable
                            ? undefined
                            : `This entry is outside your ${timesheet.backdateWindowDays}-day edit window. Ask a manager to remove it.`
                        }
                      />
                    </div>
                  </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
      {editing && (
        <EditLogModal
          log={editing}
          onClose={() => setEditing(null)}
          backdateWindowDays={timesheet.backdateWindowDays}
        />
      )}
    </div>
  );
}

function DeleteLogButton({
  logId,
  disabled,
  disabledReason,
}: {
  logId: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: () => workLogsApi.delete(logId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['timesheet'] });
      qc.invalidateQueries({ queryKey: ['calendar'] });
      qc.invalidateQueries({ queryKey: ['logs'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Deleted');
    },
    onError: (e: any) => {
      toast.error(e?.message ?? 'Failed');
    },
  });
  if (disabled) {
    return (
      <button
        className="p-1.5 rounded text-slate-200 cursor-not-allowed"
        disabled
        aria-label="Delete (locked)"
        title={disabledReason ?? 'Locked'}
        onClick={(e) => {
          if (disabledReason) toast.error(disabledReason);
          e.preventDefault();
        }}
      >
        <Trash2 size={14} />
      </button>
    );
  }
  return (
    <button
      className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50"
      onClick={() => {
        if (confirm('Delete this log entry?')) mut.mutate();
      }}
      aria-label="Delete"
    >
      <Trash2 size={14} />
    </button>
  );
}

// Keep the standalone EntriesList reference for backwards compat in case
// other components import it.
export { EntriesBlock as EntriesList };

// ---------- Edit modal ----------

function EditLogModal({
  log,
  onClose,
  backdateWindowDays,
}: {
  log: WorkLog;
  onClose: () => void;
  backdateWindowDays: number;
}) {
  const qc = useQueryClient();
  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: projectsApi.list });
  const customersQ = useQuery({ queryKey: ['customers-list'], queryFn: () => customersApi.list() });
  const tasksQ = useQuery({ queryKey: ['tasks-my'], queryFn: () => tasksApi.list({}) });
  const modulesQ = useQuery({ queryKey: ['work-modules'], queryFn: workModulesApi.list });
  const activityTypesQ = useQuery({ queryKey: ['work-activity-types'], queryFn: workActivityTypesApi.list });
  const locationsQ = useQuery({ queryKey: ['work-locations'], queryFn: workLocationsApi.list });

  const [date, setDate] = useState(log.date);
  const [projectId, setProjectId] = useState<string | null>(log.projectId ?? null);
  const [customerId, setCustomerId] = useState<string | null>(log.customerId ?? null);
  const [taskId, setTaskId] = useState<string | null>(log.taskId ?? null);
  const [startTime, setStartTime] = useState<string>(formatTimeOfDay(log.startTime));
  const [endTime, setEndTime] = useState<string>(formatTimeOfDay(log.endTime));
  const [moduleValue, setModuleValue] = useState<string>(log.moduleOther ? LOOKUP_OTHER : log.module ?? '');
  const [moduleOther, setModuleOther] = useState<string>(log.moduleOther ?? '');
  const [activityTypeValue, setActivityTypeValue] = useState<string>(log.activityTypeOther ? LOOKUP_OTHER : log.activityType ?? '');
  const [activityTypeOther, setActivityTypeOther] = useState<string>(log.activityTypeOther ?? '');
  const [locationValue, setLocationValue] = useState<string>(log.locationOther ? LOOKUP_OTHER : log.location ?? '');
  const [locationOther, setLocationOther] = useState<string>(log.locationOther ?? '');
  const [description, setDescription] = useState(log.description);

  const today = todayISODate();
  const minDate = (() => {
    const d = new Date(today + 'T00:00:00');
    d.setDate(d.getDate() - backdateWindowDays);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  })();

  const projectTasks = projectId ? (tasksQ.data ?? []).filter((t) => t.projectId === projectId) : [];

  const updateMut = useMutation({
    mutationFn: () => {
      return workLogsApi.update(log.id, {
        date,
        projectId,
        customerId,
        taskId,
        startTime: startTime || undefined,
        endTime: endTime || undefined,
        module: moduleValue === LOOKUP_OTHER ? null : moduleValue || null,
        moduleOther: moduleValue === LOOKUP_OTHER ? moduleOther : null,
        activityType: activityTypeValue === LOOKUP_OTHER ? null : activityTypeValue || null,
        activityTypeOther: activityTypeValue === LOOKUP_OTHER ? activityTypeOther : null,
        location: locationValue === LOOKUP_OTHER ? null : locationValue || null,
        locationOther: locationValue === LOOKUP_OTHER ? locationOther : null,
        description,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['timesheet'] });
      qc.invalidateQueries({ queryKey: ['calendar'] });
      qc.invalidateQueries({ queryKey: ['logs'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Updated');
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? 'Failed'),
  });

  const computedHours = computeHoursFromWindow(startTime, endTime);

  return (
    <Modal open={true} onClose={onClose} title="Edit activity" size="lg">
      <ActivityFormFields
        date={date}
        setDate={setDate}
        projectId={projectId}
        setProjectId={(v) => { setProjectId(v); if (!v) setTaskId(null); }}
        customerId={customerId}
        setCustomerId={setCustomerId}
        taskId={taskId}
        setTaskId={setTaskId}
        startTime={startTime}
        setStartTime={setStartTime}
        endTime={endTime}
        setEndTime={setEndTime}
        moduleValue={moduleValue}
        setModuleValue={setModuleValue}
        moduleOther={moduleOther}
        setModuleOther={setModuleOther}
        activityTypeValue={activityTypeValue}
        setActivityTypeValue={setActivityTypeValue}
        activityTypeOther={activityTypeOther}
        setActivityTypeOther={setActivityTypeOther}
        locationValue={locationValue}
        setLocationValue={setLocationValue}
        locationOther={locationOther}
        setLocationOther={setLocationOther}
        description={description}
        setDescription={setDescription}
        computedHours={computedHours}
        projects={projectsQ.data ?? []}
        customers={customersQ.data ?? []}
        projectTasks={projectTasks}
        modules={modulesQ.data ?? []}
        activityTypes={activityTypesQ.data ?? []}
        locations={locationsQ.data ?? []}
        today={today}
        minDate={minDate}
      />
      <div className="flex justify-end gap-2 pt-4">
        <button className="btn-secondary" onClick={onClose}>
          <X size={14} /> Cancel
        </button>
        <button
          className="btn-primary"
          onClick={() => updateMut.mutate()}
          disabled={updateMut.isPending}
        >
          {updateMut.isPending ? <Spinner /> : 'Save'}
        </button>
      </div>
    </Modal>
  );
}

// ---------- "Log activity" modal (new entry) ----------

/**
 * Trigger button + `NewWorkLogModal`. The button can either render as a
 * modal (default) or inline in the day view (when `asInlineButton` is
 * true — the day view embeds it directly so the user always sees the
 * "Log activity" affordance without a second click).
 */

type WorkLogCreatePayload = Parameters<typeof workLogsApi.create>[0];

function NewWorkLogModal({
  onClose,
  projects,
  customers,
  tasksByProject,
  modules,
  activityTypes,
  locations,
  today,
  backdateWindowDays,
  preferredDate,
  preferredProjectId,
  asInlineButton,
  onSubmit,
}: {
  onClose: () => void;
  projects: { id: string; name: string; code: string; color: string }[];
  customers: { id: string; name: string; code: string | null }[];
  tasksByProject: Map<string, any[]>;
  modules: LookupOption[];
  activityTypes: LookupOption[];
  locations: LookupOption[];
  today: string;
  backdateWindowDays: number;
  preferredDate?: string;
  preferredProjectId?: string;
  asInlineButton?: boolean;
  onSubmit: (vals: WorkLogCreatePayload) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const minDate = (() => {
    const d = new Date(today + 'T00:00:00');
    d.setDate(d.getDate() - backdateWindowDays);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  })();

  const button = (
    <button
      className="text-brand-600 hover:text-brand-700 text-sm font-medium inline-flex items-center gap-1"
      onClick={() => setOpen(true)}
    >
      <Plus size={14} /> Log activity
    </button>
  );

  if (asInlineButton && !open) {
    return (
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-600">
          Log a new activity: pick a project OR a customer, then describe
          what you were working on and for how long.
        </div>
        {button}
      </div>
    );
  }

  if (!open) {
    return (
      <>
        {button}
        {open && (
          <ActivityFormModal
            onClose={() => setOpen(false)}
            projects={projects}
            customers={customers}
            tasksByProject={tasksByProject}
            modules={modules}
            activityTypes={activityTypes}
            locations={locations}
            today={today}
            minDate={minDate}
            preferredDate={preferredDate}
            preferredProjectId={preferredProjectId}
            onSubmit={async (vals) => {
              await onSubmit(vals);
              setOpen(false);
              onClose();
            }}
          />
        )}
      </>
    );
  }

  return (
    <ActivityFormModal
      onClose={() => {
        setOpen(false);
        onClose();
      }}
      projects={projects}
      customers={customers}
      tasksByProject={tasksByProject}
      modules={modules}
      activityTypes={activityTypes}
      locations={locations}
      today={today}
      minDate={minDate}
      preferredDate={preferredDate}
      preferredProjectId={preferredProjectId}
      onSubmit={async (vals) => {
        await onSubmit(vals);
        setOpen(false);
        onClose();
      }}
    />
  );
}

function ActivityFormModal({
  onClose,
  projects,
  customers,
  tasksByProject,
  modules,
  activityTypes,
  locations,
  today,
  minDate,
  preferredDate,
  preferredProjectId,
  onSubmit,
}: {
  onClose: () => void;
  projects: { id: string; name: string; code: string; color: string }[];
  customers: { id: string; name: string; code: string | null }[];
  tasksByProject: Map<string, any[]>;
  modules: LookupOption[];
  activityTypes: LookupOption[];
  locations: LookupOption[];
  today: string;
  minDate: string;
  preferredDate?: string;
  preferredProjectId?: string;
  onSubmit: (vals: WorkLogCreatePayload) => Promise<void>;
}) {
  const user = useAuthStore((state) => state.user)!;
  const preferenceKey = `crewlog.activity.defaults.${user.tenantId}.${user.id}`;
  const remembered = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem(preferenceKey) ?? '{}') as {
        moduleValue?: string;
        moduleOther?: string;
        activityTypeValue?: string;
        activityTypeOther?: string;
        locationValue?: string;
        locationOther?: string;
      };
    } catch {
      return {};
    }
  }, [preferenceKey]);
  const initialWindow = useMemo(() => defaultTimeWindow(), []);

  const [date, setDate] = useState<string>(preferredDate ?? today);
  const [projectId, setProjectId] = useState<string | null>(preferredProjectId ?? null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [startTime, setStartTime] = useState<string>(initialWindow.start);
  const [endTime, setEndTime] = useState<string>(initialWindow.end);
  const [moduleValue, setModuleValue] = useState<string>(remembered.moduleValue ?? '');
  const [moduleOther, setModuleOther] = useState<string>(remembered.moduleOther ?? '');
  const [activityTypeValue, setActivityTypeValue] = useState<string>(remembered.activityTypeValue ?? '');
  const [activityTypeOther, setActivityTypeOther] = useState<string>(remembered.activityTypeOther ?? '');
  const [locationValue, setLocationValue] = useState<string>(remembered.locationValue ?? '');
  const [locationOther, setLocationOther] = useState<string>(remembered.locationOther ?? '');
  const [description, setDescription] = useState<string>('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (moduleValue && moduleValue !== LOOKUP_OTHER && modules.length > 0 && !modules.some((option) => option.name === moduleValue)) {
      setModuleValue('');
    }
    if (
      activityTypeValue &&
      activityTypeValue !== LOOKUP_OTHER &&
      activityTypes.length > 0 &&
      !activityTypes.some((option) => option.name === activityTypeValue)
    ) {
      setActivityTypeValue('');
    }
    if (locationValue && locationValue !== LOOKUP_OTHER && locations.length > 0 && !locations.some((option) => option.name === locationValue)) {
      setLocationValue('');
    }
  }, [activityTypeValue, activityTypes, locationValue, locations, moduleValue, modules]);

  const projectTasks = projectId ? tasksByProject.get(projectId) ?? [] : [];

  const computedHours = computeHoursFromWindow(startTime, endTime);

  async function handleSubmit() {
    if (!startTime || !endTime) {
      toast.error('Pick a start AND end time');
      return;
    }
    if (computedHours === null || computedHours <= 0) {
      toast.error('End time must be after start time');
      return;
    }
    if (projectId && customerId) {
      toast.error('Pick either a project OR a customer, not both');
      return;
    }
    if (!moduleValue) {
      toast.error('Pick or describe the module you were working on');
      return;
    }
    if (!activityTypeValue) {
      toast.error('Pick or describe the activity type');
      return;
    }
    if (!locationValue) {
      toast.error('Pick or describe where you worked');
      return;
    }
    if (moduleValue === LOOKUP_OTHER && !moduleOther.trim()) {
      toast.error('Describe the module in the "Other" field');
      return;
    }
    if (activityTypeValue === LOOKUP_OTHER && !activityTypeOther.trim()) {
      toast.error('Describe the activity type in the "Other" field');
      return;
    }
    if (locationValue === LOOKUP_OTHER && !locationOther.trim()) {
      toast.error('Describe the location in the "Other" field');
      return;
    }
    try {
      localStorage.setItem(
        preferenceKey,
        JSON.stringify({
          moduleValue,
          moduleOther: moduleValue === LOOKUP_OTHER ? moduleOther.trim() : '',
          activityTypeValue,
          activityTypeOther: activityTypeValue === LOOKUP_OTHER ? activityTypeOther.trim() : '',
          locationValue,
          locationOther: locationValue === LOOKUP_OTHER ? locationOther.trim() : '',
        })
      );
    } catch {
      // Logging still works when browser storage is disabled.
    }
    setSaving(true);
    try {
      await onSubmit({
        date,
        projectId: projectId || undefined,
        customerId: customerId || undefined,
        taskId: taskId || undefined,
        startTime,
        endTime,
        module: moduleValue === LOOKUP_OTHER ? null : moduleValue,
        moduleOther: moduleValue === LOOKUP_OTHER ? moduleOther.trim() : undefined,
        activityType: activityTypeValue === LOOKUP_OTHER ? null : activityTypeValue,
        activityTypeOther: activityTypeValue === LOOKUP_OTHER ? activityTypeOther.trim() : undefined,
        location: locationValue === LOOKUP_OTHER ? null : locationValue,
        locationOther: locationValue === LOOKUP_OTHER ? locationOther.trim() : undefined,
        description: description.trim(),
      });
    } catch {
      // The mutation surfaces its own error toast and the modal stays open.
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Log activity" size="lg">
      <ActivityFormFields
        date={date}
        setDate={setDate}
        projectId={projectId}
        setProjectId={(v) => { setProjectId(v); if (!v) setTaskId(null); }}
        customerId={customerId}
        setCustomerId={setCustomerId}
        taskId={taskId}
        setTaskId={setTaskId}
        startTime={startTime}
        setStartTime={setStartTime}
        endTime={endTime}
        setEndTime={setEndTime}
        moduleValue={moduleValue}
        setModuleValue={setModuleValue}
        moduleOther={moduleOther}
        setModuleOther={setModuleOther}
        activityTypeValue={activityTypeValue}
        setActivityTypeValue={setActivityTypeValue}
        activityTypeOther={activityTypeOther}
        setActivityTypeOther={setActivityTypeOther}
        locationValue={locationValue}
        setLocationValue={setLocationValue}
        locationOther={locationOther}
        setLocationOther={setLocationOther}
        description={description}
        setDescription={setDescription}
        computedHours={computedHours}
        projects={projects}
        customers={customers}
        projectTasks={projectTasks}
        modules={modules}
        activityTypes={activityTypes}
        locations={locations}
        today={today}
        minDate={minDate}
      />
      <div className="flex justify-end gap-2 pt-4">
        <button className="btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-primary" onClick={handleSubmit} disabled={saving}>
          {saving ? <Spinner size={14} /> : <><Plus size={14} /> Log activity</>}
        </button>
      </div>
    </Modal>
  );
}

/**
 * Shared form fields for the new-entry and edit modals. Project, customer,
 * and task establish context; module, activity type, and location are
 * independent reporting dimensions with "Other" free-text fallbacks.
 */
function ActivityFormFields(props: {
  date: string;
  setDate: (v: string) => void;
  projectId: string | null;
  setProjectId: (v: string | null) => void;
  customerId: string | null;
  setCustomerId: (v: string | null) => void;
  taskId: string | null;
  setTaskId: (v: string | null) => void;
  startTime: string;
  setStartTime: (v: string) => void;
  endTime: string;
  setEndTime: (v: string) => void;
  moduleValue: string;
  setModuleValue: (v: string) => void;
  moduleOther: string;
  setModuleOther: (v: string) => void;
  activityTypeValue: string;
  setActivityTypeValue: (v: string) => void;
  activityTypeOther: string;
  setActivityTypeOther: (v: string) => void;
  locationValue: string;
  setLocationValue: (v: string) => void;
  locationOther: string;
  setLocationOther: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  computedHours: number | null;
  projects: { id: string; name: string; code: string; color: string }[];
  customers: { id: string; name: string; code: string | null }[];
  projectTasks: { id: string; title: string }[];
  modules: LookupOption[];
  activityTypes: LookupOption[];
  locations: LookupOption[];
  today: string;
  minDate: string;
}) {
  const {
    date, setDate,
    projectId, setProjectId,
    customerId, setCustomerId,
    taskId, setTaskId,
    startTime, setStartTime,
    endTime, setEndTime,
    moduleValue, setModuleValue,
    moduleOther, setModuleOther,
    activityTypeValue, setActivityTypeValue,
    activityTypeOther, setActivityTypeOther,
    locationValue, setLocationValue,
    locationOther, setLocationOther,
    description, setDescription,
    computedHours,
    projects, customers, projectTasks,
    modules, activityTypes, locations,
    today, minDate,
  } = props;

  return (
    <div className="space-y-4">
      {/* Project XOR Customer */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="act-project">
            Project <span className="text-slate-400 text-xs font-normal">(optional)</span>
          </label>
          <select
            id="act-project"
            className="input"
            value={projectId ?? ''}
            onChange={(e) => {
              const nextProjectId = e.target.value || null;
              setProjectId(nextProjectId);
              setTaskId(null);
              if (nextProjectId) setCustomerId(null);
            }}
          >
            <option value="">— None —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {projectId && (
            <p className="mt-1 text-xs text-slate-500 flex items-center gap-1.5">
              <span
                className="w-2 h-2 rounded-full"
                style={{ background: projects.find((p) => p.id === projectId)?.color }}
              />
              Code {projects.find((p) => p.id === projectId)?.code}
            </p>
          )}
        </div>
        <div>
          <label className="label" htmlFor="act-customer">
            Customer <span className="text-slate-400 text-xs font-normal">(optional — pick instead of project)</span>
          </label>
          <select
            id="act-customer"
            className="input"
            value={customerId ?? ''}
            onChange={(e) => {
              const nextCustomerId = e.target.value || null;
              setCustomerId(nextCustomerId);
              if (nextCustomerId) {
                setProjectId(null);
                setTaskId(null);
              }
            }}
          >
            <option value="">— None —</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            If you worked for a customer but not a specific project, log it
            here. You can leave both blank for ad-hoc work.
          </p>
        </div>
      </div>

      {/* Task + Module */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="act-task">
            Task <span className="text-slate-400 text-xs font-normal">(optional)</span>
          </label>
          <select
            id="act-task"
            className="input"
            value={taskId ?? ''}
            onChange={(e) => setTaskId(e.target.value || null)}
            disabled={!projectId}
          >
            <option value="">— No specific task —</option>
            {projectTasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            Tasks only show up when a project is selected.
          </p>
        </div>
        <LookupField
          label="Module"
          icon={<Cog size={14} className="text-slate-500" />}
          htmlId="act-module"
          value={moduleValue}
          setValue={setModuleValue}
          otherValue={moduleOther}
          setOtherValue={setModuleOther}
          options={modules}
          required
        />
      </div>

      {/* Date + 24-hour time window */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="act-date">
            Date <span className="text-red-500">*</span>
          </label>
          <input
            id="act-date"
            type="date"
            className="input"
            min={minDate}
            max={today}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <p className="mt-1 text-xs text-slate-500">
            You can backdate up to {minDate && today ? (() => {
              const a = new Date(minDate + 'T00:00:00');
              const b = new Date(today + 'T00:00:00');
              const diff = Math.round((b.getTime() - a.getTime()) / 86400000);
              return diff;
            })() : 0} day(s).
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label" htmlFor="act-start">
              Start time <span className="text-red-500">*</span>
            </label>
            <select
              id="act-start"
              className="input font-mono"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            >
              <option value="">— Select —</option>
              {startTime && !TIME_OPTIONS.includes(startTime) && (
                <option value={startTime}>{startTime} (existing)</option>
              )}
              {TIME_OPTIONS.map((time) => <option key={time} value={time}>{time}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="act-end">
              End time <span className="text-red-500">*</span>
            </label>
            <select
              id="act-end"
              className="input font-mono"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
            >
              <option value="">— Select —</option>
              {endTime && !TIME_OPTIONS.includes(endTime) && (
                <option value={endTime}>{endTime} (existing)</option>
              )}
              {TIME_OPTIONS.map((time) => <option key={time} value={time}>{time}</option>)}
            </select>
          </div>
          <p className="col-span-2 mt-1 text-xs text-slate-500">
            15-minute increments. Total time:{' '}
            <span className="font-mono text-brand-700">
              {computedHours != null ? formatHm(computedHours) : '—'}
            </span>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <LookupField
          label="Activity type"
          icon={<ClipboardList size={14} className="text-slate-500" />}
          htmlId="act-activity-type"
          value={activityTypeValue}
          setValue={setActivityTypeValue}
          otherValue={activityTypeOther}
          setOtherValue={setActivityTypeOther}
          options={activityTypes}
          required
        />
        <LookupField
          label="Location"
          icon={<MapPin size={14} className="text-slate-500" />}
          htmlId="act-location"
          value={locationValue}
          setValue={setLocationValue}
          otherValue={locationOther}
          setOtherValue={setLocationOther}
          options={locations}
          required
        />
      </div>

      <div>
        <label className="label" htmlFor="act-desc">
          Notes <span className="text-slate-400 text-xs font-normal">(optional)</span>
        </label>
        <textarea
          id="act-desc"
          className="input"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe what you did — anything you'd want to remember or share."
        />
      </div>
    </div>
  );
}

/**
 * Dropdown that includes a synthetic "Other\u2026" option. When the user
 * picks it, a text input appears below so they can free-text the value.
 * The free-text value is stored in the corresponding `*_other` column on
 * the work_log row (NOT the lookup table) so a tenant can never collide with
 * the synthetic option.
 */
function LookupField(props: {
  label: string;
  icon?: React.ReactNode;
  htmlId: string;
  value: string;
  setValue: (v: string) => void;
  otherValue: string;
  setOtherValue: (v: string) => void;
  options: LookupOption[];
  required?: boolean;
}) {
  const { label, icon, htmlId, value, setValue, otherValue, setOtherValue, options, required } = props;
  const isOther = value === LOOKUP_OTHER;
  return (
    <div>
      <label className="label" htmlFor={htmlId}>
        {icon}
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>
      <select
        id={htmlId}
        className="input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        required={required}
      >
        <option value="" disabled>
          {required ? 'Pick one…' : '— None —'}
        </option>
        {options.map((o) => (
          <option key={o.id} value={o.name}>
            {o.name}
            {o.isDefault ? '' : ''}
          </option>
        ))}
        {required && <option value={LOOKUP_OTHER}>Other…</option>}
      </select>
      {isOther && (
        <input
          type="text"
          className="input mt-2"
          placeholder={`Describe the ${label.toLowerCase()}…`}
          value={otherValue}
          onChange={(e) => setOtherValue(e.target.value)}
          maxLength={200}
          autoFocus
        />
      )}
    </div>
  );
}

// ---------- Small bits ----------

function SummaryStat({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        {icon} {label}
      </div>
      <div className="mt-1 text-xl font-bold text-slate-900">{value}</div>
      {sub !== undefined && <div className="mt-1">{sub}</div>}
    </div>
  );
}
