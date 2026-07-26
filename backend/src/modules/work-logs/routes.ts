import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { config } from '../../config.js';
import { canManage } from '../../lib/jwt.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { isoDate, todayIso, daysAgoIso } from '../../lib/dates.js';
import { recordAudit, recordAuditRaw, diffFields } from '../../lib/audit.js';

const WORK_LOG_FIELDS = [
  'date',
  'project_id',
  'customer_id',
  'task_id',
  'hours',
  'description',
  'module',
  'module_other',
  'activity_type',
  'activity_type_other',
  'location',
  'location_other',
  'start_time',
  'end_time',
] as const;

/**
 * "HH:MM" string sent by the time-window picker. Kept as a string so the
 * client doesn't have to fight with timezone-introduced drift — this is
 * the LOGICAL time-of-day the worker punched, not a timezone-aware
 * instant.
 */
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');

// Each of these fields is optional on its own but the combination is
// validated by `validateTimeWindow` below. We accept either a numeric
// `hours` (legacy) OR a start_time/end_time pair (new).
const CREATE = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    projectId: z.string().uuid().nullable().optional(),
    taskId: z.string().uuid().nullable().optional(),
    customerId: z.string().uuid().nullable().optional(),
    hours: z.number().gt(0).max(24).optional(),
    startTime: timeOfDay.optional(),
    endTime: timeOfDay.optional(),
    description: z.string().max(8000).default(''),
    module: z.string().max(100).nullable().optional(),
    moduleOther: z.string().max(200).nullable().optional(),
    activityType: z.string().max(100).nullable().optional(),
    activityTypeOther: z.string().max(200).nullable().optional(),
    location: z.string().max(100).nullable().optional(),
    locationOther: z.string().max(200).nullable().optional(),
  })
  .superRefine((val, ctx) => {
    // Project XOR customer: at most one. Both null is OK (ad-hoc).
    if (val.projectId && val.customerId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['customerId'],
        message: 'Pick either a project OR a customer, not both',
      });
    }
    // Task only makes sense if a project is selected.
    if (val.taskId && !val.projectId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['taskId'],
        message: 'A task can only be set when a project is selected',
      });
    }
    // Either hours OR a time window is required.
    if (val.hours == null && (val.startTime == null || val.endTime == null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['hours'],
        message: 'Either hours or a start/end time window is required',
      });
    }
    if (val.startTime && val.endTime && val.startTime >= val.endTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endTime'],
        message: 'End time must be after start time',
      });
    }
  });

/**
 * All fields are optional on update. Cross-field validation (project vs
 * customer vs task) is re-applied inside the UPDATE handler because the
 * ZodEffects wrapping CREATE doesn't expose `.partial()` cleanly.
 */
const UPDATE = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    projectId: z.string().uuid().nullable().optional(),
    taskId: z.string().uuid().nullable().optional(),
    customerId: z.string().uuid().nullable().optional(),
    hours: z.number().gt(0).max(24).optional(),
    startTime: timeOfDay.optional(),
    endTime: timeOfDay.optional(),
    description: z.string().max(8000).optional(),
    module: z.string().max(100).nullable().optional(),
    moduleOther: z.string().max(200).nullable().optional(),
    activityType: z.string().max(100).nullable().optional(),
    activityTypeOther: z.string().max(200).nullable().optional(),
    location: z.string().max(100).nullable().optional(),
    locationOther: z.string().max(200).nullable().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.projectId && val.customerId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['customerId'],
        message: 'Pick either a project OR a customer, not both',
      });
    }
    if (val.taskId && val.projectId === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['taskId'],
        message: 'A task can only be set when a project is selected',
      });
    }
    if (val.startTime && val.endTime && val.startTime >= val.endTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endTime'],
        message: 'End time must be after start time',
      });
    }
  });

/**
 * Compute the numeric `hours` to persist from the (possibly only partially
 * provided) payload. The result is always rounded to the nearest 0.25 to
 * match the legacy display semantics (the TimeCamp grid formats hours as
 * "Xh YYm"). If the user provided hours directly we trust it; if they
 * provided a time window we compute it; otherwise we leave it alone.
 */
function computeHoursFromWindow(
  startTime: string | null | undefined,
  endTime: string | null | undefined,
  existingHours: number | null | undefined
): number | null {
  if (startTime && endTime) {
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    const totalMinutes = eh * 60 + em - (sh * 60 + sm);
    if (totalMinutes <= 0) return null;
    const raw = totalMinutes / 60;
    return Math.round(raw * 4) / 4;
  }
  return existingHours != null ? Number(existingHours) : null;
}

function shape(
  row: Record<string, any>,
  worker?: Record<string, any>,
  project?: Record<string, any>,
  task?: Record<string, any>,
  customer?: Record<string, any>
) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workerId: row.worker_id,
    worker: worker
      ? { id: worker.id, fullName: worker.full_name, email: worker.email, avatarUrl: worker.avatar_url }
      : undefined,
    date: isoDate(row.date),
    projectId: row.project_id,
    project: project
      ? { id: project.id, name: project.name, code: project.code, color: project.color }
      : null,
    customerId: row.customer_id,
    customer: customer
      ? { id: customer.id, name: customer.name, code: customer.code }
      : null,
    taskId: row.task_id,
    task: task ? { id: task.id, title: task.title } : null,
    hours: row.hours != null ? Number(row.hours) : null,
    startTime: typeof row.start_time === 'string' ? row.start_time.slice(0, 5) : null,
    endTime: typeof row.end_time === 'string' ? row.end_time.slice(0, 5) : null,
    description: row.description,
    module: row.module ?? null,
    moduleOther: row.module_other ?? null,
    activityType: row.activity_type ?? null,
    activityTypeOther: row.activity_type_other ?? null,
    location: row.location ?? null,
    locationOther: row.location_other ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Returns true iff `dateIso` is within the configured backdate window
 * (`config.backdateWindowDays`, default 2). Future dates are also rejected.
 *
 * Note: we use UTC for the comparison so worker/manager don't fight timezones
 * around midnight; the UI shows dates in the worker's local TZ but persists
 * them as plain ISO `YYYY-MM-DD`.
 */
function isWithinBackdateWindow(dateIso: string): boolean {
  const d = new Date(dateIso + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return false;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (d.getTime() > today.getTime()) return false;
  const cutoff = new Date(today);
  cutoff.setUTCDate(today.getUTCDate() - config.backdateWindowDays);
  return d.getTime() >= cutoff.getTime();
}

/**
 * Returns the expected hours for a worker on a given date:
 * 1. per-day override in `daily_capacity` (if present)
 * 2. user's `default_daily_hours` (otherwise)
 * Weekends always return 0.
 */
async function expectedHoursFor(workerId: string, dateIso: string): Promise<number> {
  if (isWeekendIso(dateIso)) return 0;
  const override = await db('daily_capacity')
    .where({ worker_id: workerId, date: dateIso })
    .first();
  if (override) return Number(override.expected_hours);
  const u = await db('users').where({ id: workerId }).first();
  return Number(u?.default_daily_hours ?? 8);
}

function backdateWindowDays(): number {
  return config.backdateWindowDays;
}

/**
 * Returns true iff `iso` (YYYY-MM-DD) is a Saturday or Sunday in local time.
 * Used to suppress expected hours for weekends — work can still be logged,
 * but it doesn't count toward the "expected" target.
 */
function isWeekendIso(iso: string): boolean {
  const dow = new Date(iso + 'T00:00:00').getDay();
  return dow === 0 || dow === 6;
}

/**
 * Kept as a thin wrapper so the per-action inserts (work_log_audit + audit_log)
 * stay in one place. New modules should call `recordAudit(...)` directly.
 */
async function auditWorkLog(
  actorId: string,
  tenantId: string,
  workLogId: string,
  action: 'create' | 'update' | 'delete',
  before: any,
  after: any
) {
  // 1) Legacy per-work-log audit table (kept for compatibility with any
  // existing consumer). New data should be read from `audit_log`.
  await db('work_log_audit').insert({
    work_log_id: workLogId,
    actor_id: actorId,
    action,
    before: JSON.stringify(before ?? null),
    after: JSON.stringify(after ?? null),
  });
  // 2) Unified tenant audit feed.
  await recordAuditRaw({
    tenantId,
    actorId,
    action: `work_log.${action}`,
    entityType: 'work_log',
    entityId: workLogId,
    payload: { before, after },
  });
}

export async function workLogRoutes(app: FastifyInstance) {
  // LIST
  app.get('/work-logs', async (req) => {
    const q = req.query as Record<string, string>;
    let qb = db('work_logs').where({ tenant_id: req.user.tid });

    // Workers see only their own
    if (req.user.role === 'worker') {
      qb = qb.where('worker_id', req.user.sub);
    } else {
      if (q.worker) qb = qb.where('worker_id', q.worker);
    }

    if (q.project) qb = qb.where('project_id', q.project);
    if (q.customer) qb = qb.where('customer_id', q.customer);
    if (q.task) qb = qb.where('task_id', q.task);
    if (q.from) qb = qb.where('date', '>=', q.from);
    if (q.to) qb = qb.where('date', '<=', q.to);

    const rows = await qb.orderBy('date', 'desc').orderBy('created_at', 'desc');
    if (!rows.length) return { items: [], dailyTotal: 0 };

    const workerIds = Array.from(new Set(rows.map((r: any) => r.worker_id)));
    const projectIds = Array.from(new Set(rows.map((r: any) => r.project_id).filter(Boolean) as string[]));
    const taskIds = Array.from(new Set(rows.map((r: any) => r.task_id).filter(Boolean) as string[]));
    const customerIds = Array.from(new Set(rows.map((r: any) => r.customer_id).filter(Boolean) as string[]));

    const [workers, projects, tasks, customers] = await Promise.all([
      workerIds.length
        ? db('users').whereIn('id', workerIds).select('id', 'full_name', 'email', 'avatar_url')
        : Promise.resolve([]),
      projectIds.length
        ? db('projects').whereIn('id', projectIds).select('id', 'name', 'code', 'color')
        : Promise.resolve([]),
      taskIds.length
        ? db('tasks').whereIn('id', taskIds).select('id', 'title')
        : Promise.resolve([]),
      customerIds.length
        ? db('customers').whereIn('id', customerIds).select('id', 'name', 'code')
        : Promise.resolve([]),
    ]);
    const wMap = new Map(workers.map((u) => [u.id, u]));
    const pMap = new Map(projects.map((p) => [p.id, p]));
    const tMap = new Map(tasks.map((t) => [t.id, t]));
    const cMap = new Map(customers.map((c) => [c.id, c]));

    const items = rows.map((r: any) =>
      shape(r, wMap.get(r.worker_id), pMap.get(r.project_id), tMap.get(r.task_id), cMap.get(r.customer_id))
    );

    return { items };
  });

  // Today
  app.get('/work-logs/today', async (req) => {
    const today = todayIso();
    const rows = await db('work_logs')
      .where({ tenant_id: req.user.tid, worker_id: req.user.sub, date: today })
      .orderBy('created_at', 'desc');

    const projectIds = Array.from(new Set(rows.map((r: any) => r.project_id).filter(Boolean) as string[]));
    const taskIds = Array.from(new Set(rows.map((r: any) => r.task_id).filter(Boolean) as string[]));
    const customerIds = Array.from(new Set(rows.map((r: any) => r.customer_id).filter(Boolean) as string[]));
    const [projects, tasks, customers] = await Promise.all([
      projectIds.length
        ? db('projects').whereIn('id', projectIds).select('id', 'name', 'code', 'color')
        : Promise.resolve([]),
      taskIds.length ? db('tasks').whereIn('id', taskIds).select('id', 'title') : Promise.resolve([]),
      customerIds.length
        ? db('customers').whereIn('id', customerIds).select('id', 'name', 'code')
        : Promise.resolve([]),
    ]);
    const pMap = new Map(projects.map((p) => [p.id, p]));
    const tMap = new Map(tasks.map((t) => [t.id, t]));
    const cMap = new Map(customers.map((c) => [c.id, c]));

    const items = rows.map((r: any) =>
      shape(r, undefined, pMap.get(r.project_id), tMap.get(r.task_id), cMap.get(r.customer_id))
    );
    const total = items.reduce((s, x) => s + (x.hours ?? 0), 0);

    return { date: today, total, items };
  });

  /**
   * Weekly timesheet for the current worker. Powers the TimeCamp-style grid:
   *   - one row per (project, task) combination logged in the window
   *   - per-day columns summing hours for that row
   *   - per-day expected hours + completion ratio
   *
   * Manager+ can pass ?worker=<id> to view another user's timesheet.
   */
  app.get('/work-logs/timesheet', async (req) => {
    const q = req.query as Record<string, string>;
    const todayStr = todayIso();

    // Default to last 7 days ending today; allow custom range.
    let startIso: string;
    let endIso: string;
    if (q.from && q.to) {
      startIso = q.from;
      endIso = q.to;
    } else {
      endIso = todayStr;
      startIso = daysAgoIso(6);
    }

    let workerId = req.user.sub;
    if (q.worker && q.worker !== req.user.sub) {
      if (!canManage(req.user.role)) throw forbidden('manager or admin required');
      const w = await db('users').where({ id: q.worker, tenant_id: req.user.tid }).first();
      if (!w) throw notFound('User');
      workerId = w.id;
    }

    const worker = await db('users').where({ id: workerId }).first();
    if (!worker) throw notFound('User');

    const rows = await db('work_logs')
      .where({ tenant_id: req.user.tid, worker_id: workerId })
      .whereBetween('date', [startIso, endIso]);

    const projectIds = Array.from(new Set(rows.map((r: any) => r.project_id).filter(Boolean) as string[]));
    const taskIds = Array.from(new Set(rows.map((r: any) => r.task_id).filter(Boolean) as string[]));
    const customerIds = Array.from(new Set(rows.map((r: any) => r.customer_id).filter(Boolean) as string[]));
    const [projects, tasks, customers] = await Promise.all([
      projectIds.length
        ? db('projects').whereIn('id', projectIds).select('id', 'name', 'code', 'color')
        : Promise.resolve([]),
      taskIds.length
        ? db('tasks').whereIn('id', taskIds).select('id', 'title')
        : Promise.resolve([]),
      customerIds.length
        ? db('customers').whereIn('id', customerIds).select('id', 'name', 'code')
        : Promise.resolve([]),
    ]);
    const pMap = new Map(projects.map((p) => [p.id, p]));
    const tMap = new Map(tasks.map((t) => [t.id, t]));
    const cMap = new Map(customers.map((c) => [c.id, c]));

    // Build day list in range (inclusive). Iterate in local time.
    const days: string[] = [];
    {
      const cur = new Date(startIso + 'T00:00:00');
      const end = new Date(endIso + 'T00:00:00');
      while (cur <= end) {
        days.push(isoDate(cur));
        cur.setDate(cur.getDate() + 1);
      }
    }

// Per-day expected hours (override or default). Weekends always have 0
// expected hours — the user explicitly said "we don't expect working at
// weekend" — but work CAN still be logged on those days.
    const overrides = await db('daily_capacity')
      .where({ worker_id: workerId })
      .whereBetween('date', [startIso, endIso]);
    const overrideMap = new Map(overrides.map((o: any) => [isoDate(o.date), Number(o.expected_hours)]));
    const defaultHours = Number(worker.default_daily_hours ?? 8);
    const dayExpected: Record<string, number> = {};
    for (const d of days) {
      if (isWeekendIso(d)) {
        dayExpected[d] = 0;
      } else {
        dayExpected[d] = overrideMap.has(d) ? (overrideMap.get(d) as number) : defaultHours;
      }
    }

    // Group entries into rows keyed by (projectId, taskId, customerId).
    // The grid is now keyed by ANY of project/customer/task so ad-hoc
    // (no project, no customer, no task) logs still get their own row.
    type RowKey = string; // `p::t::c::adhoc`
    const rowMap = new Map<
      string,
      {
        projectId: string | null;
        taskId: string | null;
        customerId: string | null;
        hoursByDay: Record<string, number>;
        entries: any[];
      }
    >();
    for (const r of rows) {
      const date = isoDate(r.date);
      const projectId = r.project_id ?? null;
      const taskId = r.task_id ?? null;
      const customerId = r.customer_id ?? null;
      const adhoc = !projectId && !customerId ? 'adhoc' : '';
      const key: RowKey = `${projectId ?? ''}::${taskId ?? ''}::${customerId ?? ''}::${adhoc}`;
      let bucket = rowMap.get(key);
      if (!bucket) {
        bucket = { projectId, taskId, customerId, hoursByDay: {}, entries: [] };
        rowMap.set(key, bucket);
      }
      bucket.hoursByDay[date] = (bucket.hoursByDay[date] ?? 0) + Number(r.hours ?? 0);
      bucket.entries.push(
        shape(
          r,
          undefined,
          projectId ? pMap.get(projectId) : null,
          taskId ? tMap.get(taskId) : null,
          customerId ? cMap.get(customerId) : null
        )
      );
    }

    const gridRows = Array.from(rowMap.entries()).map(([key, b]) => {
      const p = b.projectId ? pMap.get(b.projectId) : null;
      const t = b.taskId ? tMap.get(b.taskId) : null;
      const c = b.customerId ? cMap.get(b.customerId) : null;
      const dayHours: Record<string, number> = {};
      let total = 0;
      for (const d of days) {
        const h = b.hoursByDay[d] ?? 0;
        dayHours[d] = h;
        total += h;
      }
      return {
        key,
        project: p ? { id: p.id, name: p.name, code: p.code, color: p.color } : null,
        customer: c ? { id: c.id, name: c.name, code: c.code } : null,
        task: t ? { id: t.id, title: t.title } : null,
        adHoc: !b.projectId && !b.customerId,
        dayHours,
        total,
        entries: b.entries.sort((a, b) => a.date.localeCompare(b.date)),
      };
    });
    // Stable order: by project name, then task title, then customer, then ad-hoc last.
    gridRows.sort((a, b) => {
      const an = a.project?.name ?? '';
      const bn = b.project?.name ?? '';
      if (an !== bn) return an.localeCompare(bn);
      const at = a.task?.title ?? '';
      const bt = b.task?.title ?? '';
      if (at !== bt) return at.localeCompare(bt);
      const ac = a.customer?.name ?? '';
      const bc = b.customer?.name ?? '';
      if (ac !== bc) return ac.localeCompare(bc);
      // Ad-hoc logs sink to the bottom.
      return Number(a.adHoc) - Number(b.adHoc);
    });

    // Day totals + grand total.
    const dayTotals: Record<string, number> = {};
    let grandTotal = 0;
    for (const d of days) {
      const t = gridRows.reduce((s, r) => s + (r.dayHours[d] ?? 0), 0);
      dayTotals[d] = t;
      grandTotal += t;
    }
    const dayCompletion: Record<string, number> = {};
    // Note: NOT capped at 1 — values can exceed 1 to represent overwork.
    // The UI clamps the bar to 100% width but surfaces the actual ratio + overage.
    for (const d of days) {
      const exp = dayExpected[d] ?? defaultHours;
      dayCompletion[d] = exp > 0 ? dayTotals[d] / exp : 0;
    }

    return {
      worker: {
        id: worker.id,
        fullName: worker.full_name,
        email: worker.email,
        defaultDailyHours: Number(worker.default_daily_hours ?? 8),
        timezone: worker.timezone ?? 'UTC',
      },
      from: startIso,
      to: endIso,
      today: todayStr,
      backdateWindowDays: backdateWindowDays(),
      days,
      dayExpected,
      dayTotals,
      dayCompletion,
      grandTotal,
      rows: gridRows,
    };
  });

  /**
   * Calendar (month) view for the worker. Returns per-day logged + expected
   * hours for a month, expanded to full weeks so the UI can render a
   * 7-column grid (with leading/trailing days from the previous/next month).
   *
   * Manager+ can pass ?worker=<id> to view another user.
   */
  app.get('/work-logs/calendar', async (req) => {
    const q = req.query as Record<string, string>;

    // Resolve the target month: defaults to the month containing today.
    let year: number;
    let month: number; // 1-12
    if (q.month && /^\d{4}-\d{2}$/.test(q.month)) {
      const [y, m] = q.month.split('-').map(Number);
      year = y;
      month = m;
    } else {
      const t = new Date();
      year = t.getFullYear();
      month = t.getMonth() + 1;
    }

    // First day of the month, then back to its Monday to start the calendar grid.
    const firstOfMonth = new Date(year, month - 1, 1);
    const dow = firstOfMonth.getDay(); // 0 = Sun
    const offsetToMonday = (dow + 6) % 7;
    const gridStart = new Date(firstOfMonth);
    gridStart.setDate(gridStart.getDate() - offsetToMonday);

    // Last day of the month, then forward to its Sunday to end the grid.
    const lastOfMonth = new Date(year, month, 0);
    const lastDow = lastOfMonth.getDay();
    const offsetToSunday = (7 - lastDow) % 7;
    const gridEnd = new Date(lastOfMonth);
    gridEnd.setDate(gridEnd.getDate() + offsetToSunday);

    const fromIso = isoDate(gridStart);
    const toIso = isoDate(gridEnd);

    let workerId = req.user.sub;
    if (q.worker && q.worker !== req.user.sub) {
      if (!canManage(req.user.role)) throw forbidden('manager or admin required');
      const w = await db('users').where({ id: q.worker, tenant_id: req.user.tid }).first();
      if (!w) throw notFound('User');
      workerId = w.id;
    }
    const worker = await db('users').where({ id: workerId }).first();
    if (!worker) throw notFound('User');

    const rows = await db('work_logs')
      .where({ tenant_id: req.user.tid, worker_id: workerId })
      .whereBetween('date', [fromIso, toIso]);

    const loggedByDay: Record<string, number> = {};
    for (const r of rows) {
      const d = isoDate(r.date);
      loggedByDay[d] = (loggedByDay[d] ?? 0) + Number(r.hours ?? 0);
    }

    // Per-day expected (override or default). Weekends are always 0 — we
    // don't expect work on weekends, but work can still be logged there.
    const overrides = await db('daily_capacity')
      .where({ worker_id: workerId })
      .whereBetween('date', [fromIso, toIso]);
    const overrideMap = new Map(overrides.map((o: any) => [isoDate(o.date), Number(o.expected_hours)]));
    const defaultHours = Number(worker.default_daily_hours ?? 8);
    const expectedByDay: Record<string, number> = {};
    for (const [d, v] of Object.entries(loggedByDay)) {
      expectedByDay[d] = isWeekendIso(d)
        ? 0
        : overrideMap.has(d)
        ? (overrideMap.get(d) as number)
        : defaultHours;
    }
    // Also surface expected for any override-only days with no log yet.
    for (const o of overrides) {
      const d = isoDate(o.date);
      if (!isWeekendIso(d)) expectedByDay[d] = Number(o.expected_hours);
    }

    // Build the weeks array.
    const weeks: Array<{
      weekStart: string;
      days: Array<{ date: string; logged: number; expected: number; ratio: number; inMonth: boolean }>;
    }> = [];
    const cur = new Date(gridStart);
    while (cur <= gridEnd) {
      const days: Array<{ date: string; logged: number; expected: number; ratio: number; inMonth: boolean }> = [];
      for (let i = 0; i < 7; i++) {
        const iso = isoDate(cur);
        const logged = loggedByDay[iso] ?? 0;
        // Weekends: expected is always 0. Weekdays: override if present, else default.
        const expected = isWeekendIso(iso) ? 0 : (expectedByDay[iso] ?? defaultHours);
        const ratio = expected > 0 ? logged / expected : 0;
        days.push({
          date: iso,
          logged,
          expected,
          ratio,
          inMonth: cur.getMonth() + 1 === month,
        });
        cur.setDate(cur.getDate() + 1);
      }
      weeks.push({ weekStart: days[0].date, days });
    }

    return {
      worker: {
        id: worker.id,
        fullName: worker.full_name,
        email: worker.email,
        defaultDailyHours: defaultHours,
        timezone: worker.timezone ?? 'UTC',
      },
      month: `${year}-${String(month).padStart(2, '0')}`,
      from: fromIso,
      to: toIso,
      today: todayIso(),
      weeks,
    };
  });

  // CREATE
  app.post('/work-logs', async (req) => {
    const parsed = CREATE.safeParse(req.body);
    if (!parsed.success) throw badRequest('invalid_request', 'Invalid log payload', parsed.error.flatten());

    // Colleague rule: workers may only log time for today or up to
    // BACKDATE_WINDOW_DAYS in the past. Managers+ can log anything.
    if (!canManage(req.user.role) && !isWithinBackdateWindow(parsed.data.date)) {
      throw badRequest(
        'out_of_window',
        `You can only log time for today or up to ${backdateWindowDays()} day(s) in the past`,
        { windowDays: backdateWindowDays() }
      );
    }

    if (parsed.data.projectId) {
      const proj = await db('projects').where({ id: parsed.data.projectId, tenant_id: req.user.tid }).first();
      if (!proj) throw notFound('Project');
    }

    if (parsed.data.taskId) {
      const task = await db('tasks').where({ id: parsed.data.taskId, tenant_id: req.user.tid }).first();
      if (!task) throw notFound('Task');
    }

    if (parsed.data.customerId) {
      const cust = await db('customers').where({ id: parsed.data.customerId, tenant_id: req.user.tid }).first();
      if (!cust) throw notFound('Customer');
    }

    // Compute hours from the time window if provided, otherwise use the
    // explicit hours. This is the canonical display value.
    const hours = computeHoursFromWindow(parsed.data.startTime ?? null, parsed.data.endTime ?? null, parsed.data.hours ?? null);
    if (hours === null || hours <= 0) {
      throw badRequest('invalid_hours', 'Could not derive hours from provided time data');
    }

    const [row] = await db('work_logs')
      .insert({
        tenant_id: req.user.tid,
        worker_id: req.user.sub,
        date: parsed.data.date,
        project_id: parsed.data.projectId ?? null,
        customer_id: parsed.data.customerId ?? null,
        task_id: parsed.data.taskId ?? null,
        hours,
        start_time: parsed.data.startTime ?? null,
        end_time: parsed.data.endTime ?? null,
        description: parsed.data.description ?? '',
        module: parsed.data.module ?? null,
        module_other: parsed.data.moduleOther ?? null,
        activity_type: parsed.data.activityType ?? null,
        activity_type_other: parsed.data.activityTypeOther ?? null,
        location: parsed.data.location ?? null,
        location_other: parsed.data.locationOther ?? null,
      })
      .returning('*');

    await auditWorkLog(req.user.sub, req.user.tid, row.id, 'create', null, { ...row });
    await recordAudit(req, 'create', 'work_log', row.id, {
      after: {
        date: row.date,
        projectId: row.project_id,
        customerId: row.customer_id,
        taskId: row.task_id,
        hours: Number(row.hours),
        startTime: row.start_time,
        endTime: row.end_time,
        module: row.module,
        moduleOther: row.module_other,
        activityType: row.activity_type,
        activityTypeOther: row.activity_type_other,
        location: row.location,
        locationOther: row.location_other,
        description: row.description,
      },
    });
    await updateActualHoursForTask(row.task_id);
    return await loadAndShape(row.id, req.user.tid);
  });

  // GET one
  app.get<{ Params: { id: string } }>('/work-logs/:id', async (req) => {
    const row = await db('work_logs').where({ id: req.params.id, tenant_id: req.user.tid }).first();
    if (!row) throw notFound('Work log');
    if (req.user.role === 'worker' && row.worker_id !== req.user.sub) throw forbidden();
    const [worker, project, task, customer] = await Promise.all([
      db('users').where({ id: row.worker_id }).first(),
      row.project_id ? db('projects').where({ id: row.project_id }).first() : Promise.resolve(null),
      row.task_id ? db('tasks').where({ id: row.task_id }).first() : Promise.resolve(null),
      row.customer_id ? db('customers').where({ id: row.customer_id }).first() : Promise.resolve(null),
    ]);
    return shape(row, worker, project ?? undefined, task ?? undefined, customer ?? undefined);
  });

  // UPDATE
  app.patch<{ Params: { id: string } }>('/work-logs/:id', async (req) => {
    const row = await db('work_logs').where({ id: req.params.id, tenant_id: req.user.tid }).first();
    if (!row) throw notFound('Work log');
    const isOwner = row.worker_id === req.user.sub;
    if (req.user.role === 'worker' && !isOwner) throw forbidden();
    if (isOwner && !canManage(req.user.role) && !isWithinBackdateWindow(row.date)) {
      throw forbidden(
        `You can only edit your own logs within ${backdateWindowDays()} day(s) of the work date`
      );
    }
    const parsed = UPDATE.safeParse(req.body);
    if (!parsed.success) throw badRequest('invalid_request', 'Invalid update payload', parsed.error.flatten());

    // If the worker is trying to MOVE the log to a date outside the window, block it.
    if (
      parsed.data.date !== undefined &&
      !canManage(req.user.role) &&
      !isWithinBackdateWindow(parsed.data.date)
    ) {
      throw badRequest(
        'out_of_window',
        `You can only move your log to today or up to ${backdateWindowDays()} day(s) in the past`,
        { windowDays: backdateWindowDays() }
      );
    }

    // Cross-tenant safety for the FK columns.
    if (parsed.data.projectId) {
      const proj = await db('projects').where({ id: parsed.data.projectId, tenant_id: req.user.tid }).first();
      if (!proj) throw notFound('Project');
    }
    if (parsed.data.customerId) {
      const cust = await db('customers').where({ id: parsed.data.customerId, tenant_id: req.user.tid }).first();
      if (!cust) throw notFound('Customer');
    }
    if (parsed.data.taskId) {
      const task = await db('tasks').where({ id: parsed.data.taskId, tenant_id: req.user.tid }).first();
      if (!task) throw notFound('Task');
    }

    const before = { ...row };
    const patch: Record<string, unknown> = { updated_at: db.fn.now() };
    if (parsed.data.date !== undefined) patch.date = parsed.data.date;
    if (parsed.data.projectId !== undefined) patch.project_id = parsed.data.projectId ?? null;
    if (parsed.data.customerId !== undefined) patch.customer_id = parsed.data.customerId ?? null;
    if (parsed.data.taskId !== undefined) patch.task_id = parsed.data.taskId ?? null;
    if (parsed.data.description !== undefined) patch.description = parsed.data.description;
    if (parsed.data.module !== undefined) patch.module = parsed.data.module ?? null;
    if (parsed.data.moduleOther !== undefined) patch.module_other = parsed.data.moduleOther ?? null;
    if (parsed.data.activityType !== undefined) patch.activity_type = parsed.data.activityType ?? null;
    if (parsed.data.activityTypeOther !== undefined) patch.activity_type_other = parsed.data.activityTypeOther ?? null;
    if (parsed.data.location !== undefined) patch.location = parsed.data.location ?? null;
    if (parsed.data.locationOther !== undefined) patch.location_other = parsed.data.locationOther ?? null;
    if (parsed.data.startTime !== undefined) patch.start_time = parsed.data.startTime ?? null;
    if (parsed.data.endTime !== undefined) patch.end_time = parsed.data.endTime ?? null;

    // Hours are derived from the time window if EITHER hours or a time
    // field was provided in the patch. Take the partial view of the row
    // we're about to write so computeHoursFromWindow sees the right
    // inputs.
    const newHours = computeHoursFromWindow(
      parsed.data.startTime !== undefined ? parsed.data.startTime : row.start_time,
      parsed.data.endTime !== undefined ? parsed.data.endTime : row.end_time,
      parsed.data.hours !== undefined ? parsed.data.hours : row.hours
    );
    if (newHours !== null) patch.hours = newHours;

    await db('work_logs').where({ id: row.id }).update(patch);
    const updated = await db('work_logs').where({ id: row.id }).first();
    await auditWorkLog(req.user.sub, req.user.tid, row.id, 'update', before, updated);

    // A compact diff of changed scalar fields is more useful than the full
    // before/after snapshot for the admin/manager activity feed.
    await recordAudit(req, 'update', 'work_log', row.id, {
      diff: diffFields(before as any, updated as any, WORK_LOG_FIELDS as any),
      hours: Number(updated.hours),
      date: isoDate(updated.date),
      projectId: updated.project_id,
      customerId: updated.customer_id,
      taskId: updated.task_id,
    });

    // Recompute task actual hours for old + new task (in case reassigned)
    await updateActualHoursForTask(row.task_id);
    if (updated.task_id !== row.task_id) await updateActualHoursForTask(updated.task_id);

    return await loadAndShape(row.id, req.user.tid);
  });

  // DELETE
  app.delete<{ Params: { id: string } }>('/work-logs/:id', async (req) => {
    const row = await db('work_logs').where({ id: req.params.id, tenant_id: req.user.tid }).first();
    if (!row) throw notFound('Work log');
    const isOwner = row.worker_id === req.user.sub;
    if (req.user.role === 'worker' && !isOwner) throw forbidden();
    if (isOwner && !canManage(req.user.role) && !isWithinBackdateWindow(row.date)) {
      throw forbidden(
        `You can only delete your own logs within ${backdateWindowDays()} day(s) of the work date`
      );
    }

    // IMPORTANT: write BOTH audit rows BEFORE the actual delete.
    //
    // 1. `audit_log` has no FK on entity_id — it's fine either way, but writing
    //    it first means a failure here would surface as a 500 before the row
    //    is gone (we'd rather not delete at all than delete silently).
    // 2. `work_log_audit.work_log_id` has a FK to `work_logs.id`. After this
    //    migration (20260101000021) that column is nullable with
    //    ON DELETE SET NULL, so the audit row survives the deletion of its
    //    parent with work_log_id set to null. We still must insert BEFORE the
    //    delete so the audit row captures the row that is about to be lost.
    await auditWorkLog(req.user.sub, req.user.tid, row.id, 'delete', row, null);
    await recordAudit(req, 'delete', 'work_log', row.id, {
      before: {
        date: isoDate(row.date),
        projectId: row.project_id,
        customerId: row.customer_id,
        taskId: row.task_id,
        hours: Number(row.hours),
      },
    });

    await db('work_logs').where({ id: row.id }).delete();
    await updateActualHoursForTask(row.task_id);
    return { ok: true };
  });

  // TEAM SUMMARY (manager+)
  app.get('/work-logs/team-summary', async (req) => {
    if (!canManage(req.user.role)) throw forbidden('manager or admin required');
    const q = req.query as Record<string, string>;
    const from = q.from ?? daysAgoIso(14);
    const to = q.to ?? todayIso();

    let qb = db('work_logs')
      .where({ tenant_id: req.user.tid })
      .whereBetween('date', [from, to]);
    if (q.project) qb = qb.where('project_id', q.project);
    if (q.worker) qb = qb.where('worker_id', q.worker);

    const rows = await qb.select('worker_id', 'project_id', 'customer_id', 'date', 'hours');
    const workerIds = Array.from(new Set(rows.map((r: any) => r.worker_id)));
    const projectIds = Array.from(new Set(rows.map((r: any) => r.project_id).filter(Boolean) as string[]));
    const customerIds = Array.from(new Set(rows.map((r: any) => r.customer_id).filter(Boolean) as string[]));
    const [workers, projects, customers] = await Promise.all([
      workerIds.length
        ? db('users').whereIn('id', workerIds).select('id', 'full_name', 'avatar_url')
        : Promise.resolve([]),
      projectIds.length
        ? db('projects').whereIn('id', projectIds).select('id', 'name', 'code', 'color')
        : Promise.resolve([]),
      customerIds.length
        ? db('customers').whereIn('id', customerIds).select('id', 'name', 'code')
        : Promise.resolve([]),
    ]);
    const wMap = new Map(workers.map((u) => [u.id, u]));
    const pMap = new Map(projects.map((p) => [p.id, p]));
    const cMap = new Map(customers.map((c) => [c.id, c]));

    type Row = { worker: any; project: any; customer: any; date: string; hours: number };
    const aggregated: Row[] = rows.map((r: any) => ({
      worker: { id: r.worker_id, fullName: wMap.get(r.worker_id)?.full_name, avatarUrl: wMap.get(r.worker_id)?.avatar_url },
      project: r.project_id ? { id: r.project_id, name: pMap.get(r.project_id)?.name, code: pMap.get(r.project_id)?.code, color: pMap.get(r.project_id)?.color } : null,
      customer: r.customer_id ? { id: r.customer_id, name: cMap.get(r.customer_id)?.name, code: cMap.get(r.customer_id)?.code } : null,
      date: isoDate(r.date),
      hours: Number(r.hours ?? 0),
    }));

    // Heatmap data: { date -> [ { workerId, hours } ] }
    const heatmap: Record<string, { date: string; total: number; perWorker: Record<string, number> }> = {};
    for (const a of aggregated) {
      heatmap[a.date] ??= { date: a.date, total: 0, perWorker: {} };
      heatmap[a.date].total += a.hours;
      heatmap[a.date].perWorker[a.worker.id] = (heatmap[a.date].perWorker[a.worker.id] ?? 0) + a.hours;
    }

    // Totals per worker & per project
    const totalsByWorker: Record<string, number> = {};
    const totalsByProject: Record<string, number> = {};
    for (const a of aggregated) {
      totalsByWorker[a.worker.id] = (totalsByWorker[a.worker.id] ?? 0) + a.hours;
      if (a.project) totalsByProject[a.project.id] = (totalsByProject[a.project.id] ?? 0) + a.hours;
    }

    return {
      from,
      to,
      heatmap: Object.values(heatmap).sort((a, b) => a.date.localeCompare(b.date)),
      totalsByWorker,
      totalsByProject,
      rows: aggregated,
    };
  });

  // CSV EXPORT (manager+)
  app.get('/work-logs/export.csv', async (req, reply) => {
    if (!canManage(req.user.role)) throw forbidden('manager or admin required');
    const q = req.query as Record<string, string>;
    const from = q.from ?? daysAgoIso(30);
    const to = q.to ?? todayIso();

    let qb = db('work_logs')
      .leftJoin('users as u', 'u.id', 'work_logs.worker_id')
      .leftJoin('projects as p', 'p.id', 'work_logs.project_id')
      .leftJoin('tasks as t', 't.id', 'work_logs.task_id')
      .leftJoin('customers as c', 'c.id', 'work_logs.customer_id')
      .where('work_logs.tenant_id', req.user.tid)
      .whereBetween('work_logs.date', [from, to])
      .select(
        'work_logs.date as date',
        'work_logs.start_time as start_time',
        'work_logs.end_time as end_time',
        'work_logs.module as module',
        'work_logs.module_other as module_other',
        'work_logs.activity_type as activity_type',
        'work_logs.activity_type_other as activity_type_other',
        'work_logs.location as location',
        'work_logs.location_other as location_other',
        'u.full_name as worker',
        'u.email as worker_email',
        'p.name as project',
        'p.code as project_code',
        'c.name as customer',
        'c.code as customer_code',
        't.title as task',
        'work_logs.hours as hours',
        'work_logs.description as description'
      );
    if (q.project) qb = qb.where('work_logs.project_id', q.project);
    if (q.worker) qb = qb.where('work_logs.worker_id', q.worker);

    const rows = await qb.orderBy('work_logs.date', 'desc');
    const csvEscape = (v: unknown): string => {
      if (v == null) return '';
      const s = String(v);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };
    const toIsoDate = (v: unknown): string => {
      if (!v) return '';
      const d = typeof v === 'string' ? new Date(v) : (v as Date);
      if (Number.isNaN(d.getTime())) return String(v);
      // Format in local time to match how DATE columns round-trip.
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    };
    const trimTime = (v: unknown): string => {
      if (!v) return '';
      const s = String(v);
      return s.length >= 5 ? s.slice(0, 5) : s;
    };
    const moduleDisplay = (m: unknown, mOther: unknown): string => {
      if (mOther) return String(mOther);
      return m ? String(m) : '';
    };
    const lines = [
      'date,worker,worker_email,project,project_code,customer,customer_code,task,start_time,end_time,hours,module,activity_type,location,description',
      ...rows.map((r: any) =>
        [
          toIsoDate(r.date),
          csvEscape(r.worker),
          csvEscape(r.worker_email),
          csvEscape(r.project),
          csvEscape(r.project_code),
          csvEscape(r.customer),
          csvEscape(r.customer_code),
          csvEscape(r.task),
          trimTime(r.start_time),
          trimTime(r.end_time),
          r.hours ?? 0,
          csvEscape(moduleDisplay(r.module, r.module_other)),
          csvEscape(moduleDisplay(r.activity_type, r.activity_type_other)),
          csvEscape(moduleDisplay(r.location, r.location_other)),
          csvEscape(r.description),
        ].join(',')
      ),
    ].join('\n');

    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="work-logs-${from}-to-${to}.csv"`);
    return reply.send(lines);
  });
}

async function updateActualHoursForTask(taskId: string | null | undefined) {
  if (!taskId) return;
  const sum = await db('work_logs').where({ task_id: taskId }).sum('hours as total').first();
  const total = Number(sum?.total ?? 0);
  await db('tasks').where({ id: taskId }).update({ actual_hours: total, updated_at: db.fn.now() });
}

/**
 * Re-load a work log row and decorate it with the joined project / task /
 * customer / worker so the response payload matches the create / update
 * shape used elsewhere. Centralised so future field additions don't have
 * to be repeated.
 */
async function loadAndShape(workLogId: string, tenantId: string) {
  const row = await db('work_logs').where({ id: workLogId, tenant_id: tenantId }).first();
  if (!row) throw notFound('Work log');
  const [worker, project, task, customer] = await Promise.all([
    db('users').where({ id: row.worker_id }).first(),
    row.project_id ? db('projects').where({ id: row.project_id }).first() : Promise.resolve(null),
    row.task_id ? db('tasks').where({ id: row.task_id }).first() : Promise.resolve(null),
    row.customer_id ? db('customers').where({ id: row.customer_id }).first() : Promise.resolve(null),
  ]);
  return shape(row, worker, project ?? undefined, task ?? undefined, customer ?? undefined);
}
