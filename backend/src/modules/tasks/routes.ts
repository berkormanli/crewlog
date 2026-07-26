import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { canManage } from '../../lib/jwt.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { recordAudit } from '../../lib/audit.js';

const STATUSES = ['backlog', 'todo', 'in_progress', 'waiting', 'review', 'qa', 'done'] as const;
const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
const DIFFICULTIES = ['easy', 'medium', 'hard', 'expert'] as const;

const taskCreateSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().min(1).max(300),
  description: z.string().max(5000).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  status: z.enum(STATUSES).default('backlog'),
  priority: z.enum(PRIORITIES).default('medium'),
  difficulty: z.enum(DIFFICULTIES).default('medium'),
  dueDate: z.string().optional(),
});

const taskUpdateSchema = taskCreateSchema.partial();

const statusSchema = z.object({
  status: z.enum(STATUSES),
});

const commentSchema = z.object({
  body: z.string().min(1).max(5000),
  parentId: z.string().uuid().optional(),
});

function shapeTask(row: Record<string, any>, assignee?: Record<string, any>, creator?: Record<string, any>) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    assigneeId: row.assignee_id,
    assignee: assignee
      ? { id: assignee.id, fullName: assignee.full_name, email: assignee.email, avatarUrl: assignee.avatar_url }
      : null,
    createdBy: row.created_by,
    creator: creator
      ? { id: creator.id, fullName: creator.full_name, email: creator.email, avatarUrl: creator.avatar_url }
      : null,
    status: row.status,
    priority: row.priority,
    difficulty: row.difficulty,
    dueDate: row.due_date,
    actualHours: Number(row.actual_hours),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function loadTask(id: string, tenantId: string) {
  const row = await db('tasks').where({ id, tenant_id: tenantId }).first();
  if (!row) throw notFound('Task');
  const [assignee, creator] = await Promise.all([
    row.assignee_id ? db('users').where({ id: row.assignee_id }).first() : Promise.resolve(null),
    row.created_by ? db('users').where({ id: row.created_by }).first() : Promise.resolve(null),
  ]);
  return { row, assignee: assignee ?? undefined, creator: creator ?? undefined };
}

export async function taskRoutes(app: FastifyInstance) {
  app.get('/tasks', async (req) => {
    const q = req.query as Record<string, string>;
    let qb = db('tasks').where({ tenant_id: req.user.tid });

    // Workers see only their tasks
    if (req.user.role === 'worker') {
      qb = qb.where('assignee_id', req.user.sub);
    }

    if (q.status) qb = qb.where('status', q.status);
    if (q.priority) qb = qb.where('priority', q.priority);
    if (q.project) qb = qb.where('project_id', q.project);
    if (q.assignee) qb = qb.where('assignee_id', q.assignee);
    if (q.from) qb = qb.where('due_date', '>=', q.from);
    if (q.to) qb = qb.where('due_date', '<=', q.to);
    if (q.q) {
      const like = `%${q.q.toLowerCase()}%`;
      qb = qb.andWhere(function () {
        this.whereRaw('LOWER(title) LIKE ?', [like]).orWhereRaw('LOWER(description) LIKE ?', [like]);
      });
    }

    const rows = await qb.orderBy('created_at', 'desc');
    if (!rows.length) return [];

    const userIds = Array.from(
      new Set(rows.flatMap((r: any) => [r.assignee_id, r.created_by].filter(Boolean) as string[]))
    );
    const users = userIds.length
      ? await db('users').whereIn('id', userIds).select('id', 'full_name', 'email', 'avatar_url')
      : [];
    const uMap = new Map(users.map((u) => [u.id, u]));
    return rows.map((r: any) =>
      shapeTask(r, uMap.get(r.assignee_id), uMap.get(r.created_by))
    );
  });

  app.post('/tasks', async (req) => {
    if (!canManage(req.user.role)) throw forbidden('manager or admin required');
    const parsed = taskCreateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('invalid_request', 'Invalid task payload', parsed.error.flatten());

    const proj = await db('projects').where({ id: parsed.data.projectId, tenant_id: req.user.tid }).first();
    if (!proj) throw notFound('Project');

    const [row] = await db('tasks')
      .insert({
        tenant_id: req.user.tid,
        project_id: parsed.data.projectId,
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        assignee_id: parsed.data.assigneeId ?? null,
        created_by: req.user.sub,
        status: parsed.data.status,
        priority: parsed.data.priority,
        difficulty: parsed.data.difficulty,
        due_date: parsed.data.dueDate ?? null,
      })
      .returning('*');

    await db('task_activity').insert({
      task_id: row.id,
      actor_id: req.user.sub,
      action: 'created',
      payload: JSON.stringify({ title: row.title }),
    });

    const { assignee, creator } = await loadTask(row.id, req.user.tid);
    await recordAudit(req, 'create', 'task', row.id, {
      after: {
        title: row.title,
        projectId: row.project_id,
        assigneeId: row.assignee_id,
        status: row.status,
        priority: row.priority,
      },
      assigneeName: assignee?.full_name ?? null,
    });
    return shapeTask(row, assignee, creator);
  });

  app.get<{ Params: { id: string } }>('/tasks/:id', async (req) => {
    const { row, assignee, creator } = await loadTask(req.params.id, req.user.tid);
    // Workers can only see their own tasks
    if (req.user.role === 'worker' && row.assignee_id !== req.user.sub) {
      throw forbidden('You can only view your own tasks');
    }
    const [comments, activity] = await Promise.all([
      db('task_comments as c')
        .leftJoin('users as u', 'u.id', 'c.author_id')
        .where('c.task_id', req.params.id)
        .orderBy('c.created_at', 'asc')
        .select('c.id', 'c.body', 'c.parent_id', 'c.created_at', 'c.author_id', 'u.full_name', 'u.email', 'u.avatar_url'),
      db('task_activity as a')
        .leftJoin('users as u', 'u.id', 'a.actor_id')
        .where('a.task_id', req.params.id)
        .orderBy('a.created_at', 'desc')
        .limit(50)
        .select('a.id', 'a.action', 'a.payload', 'a.created_at', 'a.actor_id', 'u.full_name', 'u.email'),
    ]);

    return {
      ...shapeTask(row, assignee, creator),
      comments: comments.map((c: any) => ({
        id: c.id,
        body: c.body,
        parentId: c.parent_id,
        createdAt: c.created_at,
        author: c.author_id
          ? { id: c.author_id, fullName: c.full_name, email: c.email, avatarUrl: c.avatar_url }
          : null,
      })),
      activity: activity.map((a: any) => ({
        id: a.id,
        action: a.action,
        payload: a.payload,
        createdAt: a.created_at,
        actor: a.actor_id ? { id: a.actor_id, fullName: a.full_name, email: a.email } : null,
      })),
    };
  });

  app.patch<{ Params: { id: string } }>('/tasks/:id', async (req) => {
    const { row } = await loadTask(req.params.id, req.user.tid);
    if (req.user.role === 'worker' && row.assignee_id !== req.user.sub) {
      throw forbidden('You can only update your own tasks');
    }
    const parsed = taskUpdateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('invalid_request', 'Invalid update payload', parsed.error.flatten());

    const patch: Record<string, unknown> = { updated_at: db.fn.now() };
    if (parsed.data.projectId !== undefined) patch.project_id = parsed.data.projectId;
    if (parsed.data.title !== undefined) patch.title = parsed.data.title;
    if (parsed.data.description !== undefined) patch.description = parsed.data.description;
    if (parsed.data.assigneeId !== undefined) {
      if (parsed.data.assigneeId && row.assignee_id !== parsed.data.assigneeId) {
        await db('task_activity').insert({
          task_id: row.id,
          actor_id: req.user.sub,
          action: 'assigned',
          payload: JSON.stringify({ from: row.assignee_id, to: parsed.data.assigneeId }),
        });
      }
      patch.assignee_id = parsed.data.assigneeId;
    }
    if (parsed.data.status !== undefined) patch.status = parsed.data.status;
    if (parsed.data.priority !== undefined) patch.priority = parsed.data.priority;
    if (parsed.data.difficulty !== undefined) patch.difficulty = parsed.data.difficulty;
    if (parsed.data.dueDate !== undefined) patch.due_date = parsed.data.dueDate;

    await db('tasks').where({ id: req.params.id }).update(patch);
    const out = await loadTask(req.params.id, req.user.tid);
    const diff: Record<string, { from: any; to: any }> = {};
    const tracked = [
      'project_id',
      'title',
      'description',
      'assignee_id',
      'status',
      'priority',
      'difficulty',
      'due_date',
    ];
    for (const f of tracked) {
      const a = (row as any)[f];
      const b = (out.row as any)[f];
      if (a !== b) diff[f] = { from: a, to: b };
    }
    if (Object.keys(diff).length > 0) {
      await recordAudit(req, 'update', 'task', row.id, { diff });
    }
    return shapeTask(out.row, out.assignee, out.creator);
  });

  app.delete<{ Params: { id: string } }>('/tasks/:id', async (req) => {
    if (!canManage(req.user.role)) throw forbidden('manager or admin required');
    const existing = await db('tasks').where({ id: req.params.id, tenant_id: req.user.tid }).first();
    if (!existing) throw notFound('Task');
    await db('tasks').where({ id: req.params.id }).delete();
    await recordAudit(req, 'delete', 'task', req.params.id, {
      before: {
        title: existing.title,
        projectId: existing.project_id,
        status: existing.status,
      },
    });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/tasks/:id/status', async (req) => {
    const { row } = await loadTask(req.params.id, req.user.tid);
    if (req.user.role === 'worker' && row.assignee_id !== req.user.sub) {
      throw forbidden('You can only update your own tasks');
    }
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('invalid_request', 'Invalid status');

    if (row.status !== parsed.data.status) {
      await db('task_activity').insert({
        task_id: row.id,
        actor_id: req.user.sub,
        action: 'status_changed',
        payload: JSON.stringify({ from: row.status, to: parsed.data.status }),
      });
      await recordAudit(req, 'update', 'task', row.id, {
        diff: { status: { from: row.status, to: parsed.data.status } },
        kind: 'status_change',
        taskTitle: row.title,
      });
    }

    await db('tasks').where({ id: row.id }).update({
      status: parsed.data.status,
      updated_at: db.fn.now(),
    });
    const updated = await db('tasks').where({ id: row.id }).first();
    return shapeTask(updated);
  });

  app.post<{ Params: { id: string } }>('/tasks/:id/comments', async (req) => {
    const { row } = await loadTask(req.params.id, req.user.tid);
    if (req.user.role === 'worker' && row.assignee_id !== req.user.sub) {
      throw forbidden('You can only comment on your own tasks');
    }
    const parsed = commentSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('invalid_request', 'Invalid comment');

    if (parsed.data.parentId) {
      const parent = await db('task_comments').where({ id: parsed.data.parentId, task_id: row.id }).first();
      if (!parent) throw notFound('Parent comment');
      // One-level threading: parent must itself be top-level
      if (parent.parent_id) throw badRequest('cannot_reply_to_reply', 'Replies cannot be nested');
    }

    const [created] = await db('task_comments')
      .insert({
        task_id: row.id,
        author_id: req.user.sub,
        body: parsed.data.body,
        parent_id: parsed.data.parentId ?? null,
      })
      .returning(['id', 'body', 'parent_id', 'created_at', 'author_id']);

    await db('task_activity').insert({
      task_id: row.id,
      actor_id: req.user.sub,
      action: 'commented',
      payload: JSON.stringify({ commentId: created.id }),
    });

    await recordAudit(req, 'create', 'task_comment', created.id, {
      taskId: row.id,
      taskTitle: row.title,
      bodyPreview: parsed.data.body.slice(0, 200),
      parentId: parsed.data.parentId ?? null,
    });

    const author = await db('users').where({ id: req.user.sub }).first();
    return {
      id: created.id,
      body: created.body,
      parentId: created.parent_id,
      createdAt: created.created_at,
      author: { id: author.id, fullName: author.full_name, email: author.email, avatarUrl: author.avatar_url },
    };
  });

  app.get<{ Params: { id: string } }>('/tasks/:id/comments', async (req) => {
    const { row } = await loadTask(req.params.id, req.user.tid);
    if (req.user.role === 'worker' && row.assignee_id !== req.user.sub) {
      throw forbidden('You can only view your own tasks');
    }
    return db('task_comments as c')
      .leftJoin('users as u', 'u.id', 'c.author_id')
      .where('c.task_id', req.params.id)
      .orderBy('c.created_at', 'asc')
      .select('c.id', 'c.body', 'c.parent_id', 'c.created_at', 'c.author_id', 'u.full_name', 'u.email', 'u.avatar_url');
  });
}
