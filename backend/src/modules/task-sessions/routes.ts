import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { canManage } from '../../lib/jwt.js';
import { recordAudit } from '../../lib/audit.js';
import { elapsedSeconds, asDate, buildStopDescription } from './elapsed.js';

type SessionStatus = 'running' | 'paused' | 'stopped';

const emptyBody = z.object({}).passthrough();

// Optional note when stopping a session. Trimmed and capped to keep work-log
// descriptions reasonable; if omitted, a sensible default is used.
const stopBody = z.object({
  note: z
    .string()
    .trim()
    .max(1000, 'Note must be 1000 characters or fewer')
    .optional(),
});

function shape(row: Record<string, any>, now = new Date()) {
  const elapsed = elapsedSeconds(row as any, now);
  return {
    id: row.id,
    tenantId: row.tenant_id,
    taskId: row.task_id,
    workerId: row.worker_id,
    status: row.status as SessionStatus,
    startedAt: row.started_at,
    activeStartedAt: row.active_started_at,
    pausedAt: row.paused_at,
    endedAt: row.ended_at,
    elapsedSeconds: elapsed,
    accumulatedSeconds: Number(row.accumulated_seconds ?? 0),
    durationSeconds: row.status === 'stopped' ? Number(row.duration_seconds ?? elapsed) : null,
    workLogId: row.work_log_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function loadAccessibleTask(taskId: string, tenantId: string, user: any) {
  const task = await db('tasks').where({ id: taskId, tenant_id: tenantId }).first();
  if (!task) throw notFound('Task');
  if (user.role === 'worker' && task.assignee_id !== user.sub) {
    throw forbidden('You can only use the timer on your own tasks');
  }
  return task;
}

async function activeForWorker(workerId: string, tenantId: string) {
  return db('task_work_sessions')
    .where({ tenant_id: tenantId, worker_id: workerId })
    .whereIn('status', ['running', 'paused'])
    .first();
}

async function localDate(date: Date, timezone: string | null | undefined): Promise<string> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function roundHours(seconds: number): number {
  return Math.round((seconds / 3600) * 4) / 4;
}

async function updateActualHours(trx: any, taskId: string) {
  const sum = await trx('work_logs').where({ task_id: taskId }).sum('hours as total').first();
  await trx('tasks').where({ id: taskId }).update({
    actual_hours: Number(sum?.total ?? 0),
    updated_at: trx.fn.now(),
  });
}

async function moveToInProgress(task: Record<string, any>, actorId: string, trx: any) {
  if (!['backlog', 'todo', 'waiting'].includes(task.status)) return;
  await trx('tasks').where({ id: task.id }).update({ status: 'in_progress', updated_at: trx.fn.now() });
  await trx('task_activity').insert({
    task_id: task.id,
    actor_id: actorId,
    action: 'status_changed',
    payload: JSON.stringify({ from: task.status, to: 'in_progress', reason: 'timer_started' }),
  });
}

export async function taskSessionRoutes(app: FastifyInstance) {
  // Current user's active session, useful for a persistent global timer later.
  app.get('/task-sessions/active', async (req) => {
    const row = await activeForWorker(req.user.sub, req.user.tid);
    if (!row) return { session: null };
    const task = await db('tasks').where({ id: row.task_id, tenant_id: req.user.tid }).select('id', 'title').first();
    return {
      session: { ...shape(row), task: task ? { id: task.id, title: task.title } : null },
    };
  });

  app.get<{ Params: { id: string } }>('/tasks/:id/sessions', async (req) => {
    await loadAccessibleTask(req.params.id, req.user.tid, req.user);
    const rows = await db('task_work_sessions')
      .where({ tenant_id: req.user.tid, task_id: req.params.id })
      .orderBy('created_at', 'desc')
      .limit(50);
    return {
      active: rows.find((row: any) => row.worker_id === req.user.sub && ['running', 'paused'].includes(row.status))
        ? shape(rows.find((row: any) => row.worker_id === req.user.sub && ['running', 'paused'].includes(row.status)))
        : null,
      items: rows.map((row: any) => shape(row)),
    };
  });

  app.post<{ Params: { id: string } }>('/tasks/:id/sessions/start', async (req) => {
    const task = await loadAccessibleTask(req.params.id, req.user.tid, req.user);
    const existing = await activeForWorker(req.user.sub, req.user.tid);
    if (existing) {
      throw conflict('You already have an active task session. Stop or pause it before starting another.', 'active_session');
    }

    const now = new Date();
    const [row] = await db.transaction(async (trx) => {
      const [created] = await trx('task_work_sessions')
        .insert({
          tenant_id: req.user.tid,
          task_id: task.id,
          worker_id: req.user.sub,
          status: 'running',
          started_at: now,
          active_started_at: now,
          accumulated_seconds: 0,
        })
        .returning('*');
      await moveToInProgress(task, req.user.sub, trx);
      return [created];
    });

    await recordAudit(req, 'create', 'task_work_session', row.id, {
      taskId: task.id,
      status: 'running',
      kind: 'timer_start',
    });
    return shape(row);
  });

  app.post<{ Params: { id: string } }>('/tasks/:id/sessions/pause', async (req) => {
    await emptyBody.parseAsync(req.body ?? {});
    const task = await loadAccessibleTask(req.params.id, req.user.tid, req.user);
    const row = await db('task_work_sessions')
      .where({ tenant_id: req.user.tid, task_id: task.id, worker_id: req.user.sub, status: 'running' })
      .first();
    if (!row) throw badRequest('no_running_session', 'There is no running session for this task');

    const now = new Date();
    const added = Math.max(0, Math.floor((now.getTime() - asDate(row.active_started_at).getTime()) / 1000));
    const [updated] = await db('task_work_sessions')
      .where({ id: row.id })
      .update({
        status: 'paused',
        paused_at: now,
        active_started_at: null,
        accumulated_seconds: Number(row.accumulated_seconds ?? 0) + added,
        updated_at: db.fn.now(),
      })
      .returning('*');

    await recordAudit(req, 'update', 'task_work_session', row.id, {
      taskId: task.id,
      diff: { status: { from: 'running', to: 'paused' } },
      kind: 'timer_pause',
    });
    return shape(updated);
  });

  app.post<{ Params: { id: string } }>('/tasks/:id/sessions/resume', async (req) => {
    await emptyBody.parseAsync(req.body ?? {});
    const task = await loadAccessibleTask(req.params.id, req.user.tid, req.user);
    const existing = await activeForWorker(req.user.sub, req.user.tid);
    if (existing && existing.task_id !== task.id) {
      throw conflict('You already have an active session on another task.', 'active_session');
    }
    const row = await db('task_work_sessions')
      .where({ tenant_id: req.user.tid, task_id: task.id, worker_id: req.user.sub, status: 'paused' })
      .first();
    if (!row) throw badRequest('no_paused_session', 'There is no paused session for this task');

    const [updated] = await db('task_work_sessions')
      .where({ id: row.id })
      .update({
        status: 'running',
        paused_at: null,
        active_started_at: new Date(),
        updated_at: db.fn.now(),
      })
      .returning('*');

    await recordAudit(req, 'update', 'task_work_session', row.id, {
      taskId: task.id,
      diff: { status: { from: 'paused', to: 'running' } },
      kind: 'timer_resume',
    });
    return shape(updated);
  });

  app.post<{ Params: { id: string } }>('/tasks/:id/sessions/stop', async (req) => {
    const parsed = await stopBody.parseAsync(req.body ?? {});
    const task = await loadAccessibleTask(req.params.id, req.user.tid, req.user);
    const row = await db('task_work_sessions')
      .where({ tenant_id: req.user.tid, task_id: task.id, worker_id: req.user.sub })
      .whereIn('status', ['running', 'paused'])
      .first();
    if (!row) throw badRequest('no_active_session', 'There is no active session for this task');

    const now = new Date();
    const added = row.status === 'running'
      ? Math.max(0, Math.floor((now.getTime() - asDate(row.active_started_at).getTime()) / 1000))
      : 0;
    const durationSeconds = Number(row.accumulated_seconds ?? 0) + added;
    const hours = roundHours(durationSeconds);
    const worker = await db('users').where({ id: req.user.sub, tenant_id: req.user.tid }).first();
    const description = buildStopDescription(parsed.note, task.title);

    const result = await db.transaction(async (trx) => {
      const workLog = hours >= 0.25
        ? (await trx('work_logs').insert({
            tenant_id: req.user.tid,
            worker_id: req.user.sub,
            date: await localDate(asDate(row.started_at), worker?.timezone),
            project_id: task.project_id,
            task_id: task.id,
            hours,
            description,
          }).returning('id'))[0]
        : null;

      const [updated] = await trx('task_work_sessions')
        .where({ id: row.id })
        .update({
          status: 'stopped',
          ended_at: now,
          active_started_at: null,
          duration_seconds: durationSeconds,
          accumulated_seconds: durationSeconds,
          work_log_id: workLog?.id ?? null,
          updated_at: trx.fn.now(),
        })
        .returning('*');

      if (workLog) await updateActualHours(trx, task.id);
      return { session: updated, workLogId: workLog?.id ?? null };
    });

    await recordAudit(req, 'update', 'task_work_session', row.id, {
      taskId: task.id,
      diff: { status: { from: row.status, to: 'stopped' } },
      durationSeconds,
      hours,
      workLogId: result.workLogId,
      kind: 'timer_stop',
    });
    return { ...shape(result.session), workLogId: result.workLogId, roundedHours: hours };
  });
}
