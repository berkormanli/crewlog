import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { canManage } from '../../lib/jwt.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { recordAudit } from '../../lib/audit.js';

const STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
const DIFFICULTIES = ['easy', 'medium', 'hard', 'expert'] as const;

const requestCreateSchema = z.object({
  projectId: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(300),
  description: z.string().max(5000).optional(),
  priority: z.enum(PRIORITIES).default('medium'),
  difficulty: z.enum(DIFFICULTIES).default('medium'),
  dueDate: z.string().optional(),
});

const requestUpdateSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(5000).optional(),
  priority: z.enum(PRIORITIES).optional(),
  difficulty: z.enum(DIFFICULTIES).optional(),
  dueDate: z.string().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
});

const reviewSchema = z.object({
  note: z.string().max(2000).optional(),
});

function shape(
  row: Record<string, any>,
  requester?: Record<string, any>,
  reviewer?: Record<string, any>,
  project?: Record<string, any>
) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    requestedBy: row.requested_by,
    requester: requester
      ? { id: requester.id, fullName: requester.full_name, email: requester.email, avatarUrl: requester.avatar_url }
      : null,
    projectId: row.project_id,
    project: project
      ? { id: project.id, name: project.name, code: project.code, color: project.color }
      : null,
    title: row.title,
    description: row.description,
    priority: row.priority,
    difficulty: row.difficulty,
    dueDate: row.due_date,
    status: row.status,
    reviewedBy: row.reviewed_by,
    reviewer: reviewer
      ? { id: reviewer.id, fullName: reviewer.full_name, email: reviewer.email }
      : null,
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note,
    createdTaskId: row.created_task_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function loadRequest(id: string, tenantId: string) {
  const row = await db('task_requests').where({ id, tenant_id: tenantId }).first();
  if (!row) throw notFound('Task request');
  const [requester, reviewer, project] = await Promise.all([
    db('users').where({ id: row.requested_by }).first(),
    row.reviewed_by ? db('users').where({ id: row.reviewed_by }).first() : Promise.resolve(null),
    row.project_id ? db('projects').where({ id: row.project_id }).first() : Promise.resolve(null),
  ]);
  return {
    row,
    requester,
    reviewer: reviewer ?? undefined,
    project,
  };
}

export async function taskRequestRoutes(app: FastifyInstance) {
  // LIST
  // Workers see only their own requests. Managers+ see everything (filterable).
  app.get('/task-requests', async (req) => {
    const q = req.query as Record<string, string>;
    let qb = db('task_requests').where({ tenant_id: req.user.tid });
    if (req.user.role === 'worker') {
      qb = qb.where('requested_by', req.user.sub);
    } else if (q.requester) {
      qb = qb.where('requested_by', q.requester);
    }
    if (q.status) qb = qb.where('status', q.status);
    if (q.project) qb = qb.where('project_id', q.project);

    const rows = await qb.orderBy('created_at', 'desc');
    if (!rows.length) return [];

    const userIds = Array.from(
      new Set(rows.flatMap((r: any) => [r.requested_by, r.reviewed_by]).filter(Boolean) as string[])
    );
    const projectIds = Array.from(new Set(rows.map((r: any) => r.project_id).filter(Boolean) as string[]));
    const [users, projects] = await Promise.all([
      userIds.length
        ? db('users').whereIn('id', userIds).select('id', 'full_name', 'email', 'avatar_url')
        : Promise.resolve([]),
      projectIds.length
        ? db('projects').whereIn('id', projectIds).select('id', 'name', 'code', 'color')
        : Promise.resolve([]),
    ]);
    const uMap = new Map(users.map((u) => [u.id, u]));
    const pMap = new Map(projects.map((p) => [p.id, p]));

    return rows.map((r: any) =>
      shape(
        r,
        uMap.get(r.requested_by),
        uMap.get(r.reviewed_by),
        pMap.get(r.project_id)
      )
    );
  });

  // GET one
  app.get<{ Params: { id: string } }>('/task-requests/:id', async (req) => {
    const { row, requester, reviewer, project } = await loadRequest(req.params.id, req.user.tid);
    if (req.user.role === 'worker' && row.requested_by !== req.user.sub) {
      throw forbidden('You can only view your own requests');
    }
    return shape(row, requester, reviewer, project);
  });

  // CREATE — anyone authenticated may submit a request.
  app.post('/task-requests', async (req) => {
    const parsed = requestCreateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('invalid_request', 'Invalid request payload', parsed.error.flatten());

    // If a project is specified, verify it belongs to the same tenant.
    if (parsed.data.projectId) {
      const proj = await db('projects')
        .where({ id: parsed.data.projectId, tenant_id: req.user.tid })
        .first();
      if (!proj) throw notFound('Project');
    }

    const [row] = await db('task_requests')
      .insert({
        tenant_id: req.user.tid,
        requested_by: req.user.sub,
        project_id: parsed.data.projectId ?? null,
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        priority: parsed.data.priority,
        difficulty: parsed.data.difficulty,
        due_date: parsed.data.dueDate ?? null,
        status: 'pending',
      })
      .returning('*');

    await recordAudit(req, 'create', 'task_request', row.id, {
      after: {
        title: row.title,
        projectId: row.project_id,
        priority: row.priority,
        difficulty: row.difficulty,
        dueDate: row.due_date,
      },
    });

    const { requester, reviewer, project } = await loadRequest(row.id, req.user.tid);
    return shape(row, requester, reviewer, project);
  });

  // PATCH — owner can edit a pending request; managers+ can attach a review note.
  app.patch<{ Params: { id: string } }>('/task-requests/:id', async (req) => {
    const { row } = await loadRequest(req.params.id, req.user.tid);
    const isOwner = row.requested_by === req.user.sub;

    if (req.user.role === 'worker' && !isOwner) {
      throw forbidden('You can only update your own requests');
    }
    // Only managers+ can change review fields on someone else's request.
    const parsed = requestUpdateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('invalid_request', 'Invalid update payload', parsed.error.flatten());

    // Pending requests can be edited by the owner (or manager+).
    if (row.status !== 'pending') {
      // Managers+ may still edit to fix a typo on already-reviewed requests.
      if (!canManage(req.user.role)) {
        throw badRequest('not_editable', 'This request has already been reviewed and is no longer editable');
      }
    }

    const patch: Record<string, unknown> = { updated_at: db.fn.now() };
    if (parsed.data.title !== undefined) patch.title = parsed.data.title;
    if (parsed.data.description !== undefined) patch.description = parsed.data.description;
    if (parsed.data.priority !== undefined) patch.priority = parsed.data.priority;
    if (parsed.data.difficulty !== undefined) patch.difficulty = parsed.data.difficulty;
    if (parsed.data.dueDate !== undefined) patch.due_date = parsed.data.dueDate;
    if (parsed.data.projectId !== undefined) {
      if (parsed.data.projectId) {
        const proj = await db('projects')
          .where({ id: parsed.data.projectId, tenant_id: req.user.tid })
          .first();
        if (!proj) throw notFound('Project');
      }
      patch.project_id = parsed.data.projectId;
    }

    await db('task_requests').where({ id: row.id }).update(patch);
    const out = await loadRequest(req.params.id, req.user.tid);
    const tracked = ['title', 'description', 'priority', 'difficulty', 'due_date', 'project_id'];
    const diff: Record<string, { from: any; to: any }> = {};
    for (const f of tracked) {
      const a = (row as any)[f];
      const b = (out.row as any)[f];
      if (a !== b) diff[f] = { from: a, to: b };
    }
    if (Object.keys(diff).length > 0) {
      await recordAudit(req, 'update', 'task_request', row.id, { diff });
    }
    return shape(out.row, out.requester, out.reviewer, out.project);
  });

  // DELETE — owner can cancel while pending; managers+ can delete anything.
  app.delete<{ Params: { id: string } }>('/task-requests/:id', async (req) => {
    const { row } = await loadRequest(req.params.id, req.user.tid);
    const isOwner = row.requested_by === req.user.sub;
    if (!canManage(req.user.role) && !isOwner) {
      throw forbidden('You can only delete your own requests');
    }
    if (!canManage(req.user.role) && row.status !== 'pending') {
      throw badRequest('not_deletable', 'You can only delete pending requests');
    }
    const wasPending = row.status === 'pending';
    await db('task_requests').where({ id: req.params.id }).delete();
    await recordAudit(
      req,
      wasPending ? 'cancel' : 'delete',
      'task_request',
      req.params.id,
      { before: { title: row.title, status: row.status } }
    );
    return { ok: true };
  });

  // APPROVE — manager+: materializes a real task from the request.
  app.post<{ Params: { id: string } }>('/task-requests/:id/approve', async (req) => {
    if (!canManage(req.user.role)) throw forbidden('manager or admin required');
    const parsed = reviewSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('invalid_request', 'Invalid review payload', parsed.error.flatten());

    const { row } = await loadRequest(req.params.id, req.user.tid);
    if (row.status !== 'pending') {
      throw badRequest('already_reviewed', `Request is already ${row.status}`);
    }
    if (!row.project_id) {
      throw badRequest('no_project', 'Cannot approve a request without a bound project');
    }

    // Create the actual task. Default assignee is the requester so it doesn't sit unowned.
    const [task] = await db('tasks')
      .insert({
        tenant_id: req.user.tid,
        project_id: row.project_id,
        title: row.title,
        description: row.description ?? null,
        assignee_id: row.requested_by,
        created_by: req.user.sub,
        status: 'todo',
        priority: row.priority,
        difficulty: row.difficulty,
        due_date: row.due_date,
      })
      .returning('*');

    await db('task_activity').insert({
      task_id: task.id,
      actor_id: req.user.sub,
      action: 'created',
      payload: JSON.stringify({ fromRequest: row.id, title: row.title }),
    });

    await db('task_requests').where({ id: row.id }).update({
      status: 'approved',
      reviewed_by: req.user.sub,
      reviewed_at: db.fn.now(),
      review_note: parsed.data.note ?? null,
      created_task_id: task.id,
      updated_at: db.fn.now(),
    });

    await recordAudit(req, 'approve', 'task_request', row.id, {
      title: row.title,
      createdTaskId: task.id,
      createdTaskTitle: task.title,
      reviewerNote: parsed.data.note ?? null,
    });

    const out = await loadRequest(row.id, req.user.tid);
    return { ...shape(out.row, out.requester, out.reviewer, out.project), createdTask: task };
  });

  // REJECT — manager+: marks rejected with optional review note.
  app.post<{ Params: { id: string } }>('/task-requests/:id/reject', async (req) => {
    if (!canManage(req.user.role)) throw forbidden('manager or admin required');
    const parsed = reviewSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('invalid_request', 'Invalid review payload', parsed.error.flatten());

    const { row } = await loadRequest(req.params.id, req.user.tid);
    if (row.status !== 'pending') {
      throw badRequest('already_reviewed', `Request is already ${row.status}`);
    }

    await db('task_requests').where({ id: row.id }).update({
      status: 'rejected',
      reviewed_by: req.user.sub,
      reviewed_at: db.fn.now(),
      review_note: parsed.data.note ?? null,
      updated_at: db.fn.now(),
    });

    await recordAudit(req, 'reject', 'task_request', row.id, {
      title: row.title,
      reviewerNote: parsed.data.note ?? null,
    });

    const out = await loadRequest(row.id, req.user.tid);
    return shape(out.row, out.requester, out.reviewer, out.project);
  });
}