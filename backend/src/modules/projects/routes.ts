import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { canManage } from '../../lib/jwt.js';
import { badRequest, forbidden, notFound, unprocessable } from '../../lib/errors.js';
import { recordAudit } from '../../lib/audit.js';

const projectCreateSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/i),
  description: z.string().max(2000).optional(),
  status: z.enum(['active', 'paused', 'archived']).default('active'),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#3b82f6'),
  // Free-text client name retained for backwards compat (used when the project
  // is NOT bound to a managed customer).
  clientName: z.string().max(200).optional(),
  customerId: z.string().uuid().nullable().optional(),
});

const projectUpdateSchema = projectCreateSchema.partial();

const addMemberSchema = z.object({
  userId: z.string().uuid(),
  roleInProject: z.enum(['lead', 'contributor', 'observer']).default('contributor'),
});

function shape(row: Record<string, any>, customer?: Record<string, any>) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    code: row.code,
    description: row.description,
    status: row.status,
    startDate: row.start_date,
    endDate: row.end_date,
    color: row.color,
    clientName: row.client_name,
    customerId: row.customer_id ?? null,
    customer: customer
      ? { id: customer.id, name: customer.name, code: customer.code }
      : null,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Hydrate the joined `customers` row for a batch of project rows in one query.
 * Avoids N+1 lookups when listing projects.
 */
async function hydrateCustomers(projects: any[], tenantId: string): Promise<Map<string, any>> {
  const ids = Array.from(new Set(projects.map((p) => p.customer_id).filter(Boolean) as string[]));
  if (!ids.length) return new Map();
  const rows = await db('customers')
    .where({ tenant_id: tenantId })
    .whereIn('id', ids)
    .select('id', 'name', 'code');
  return new Map(rows.map((r) => [r.id, r]));
}

export async function projectRoutes(app: FastifyInstance) {
  app.get('/projects', async (req) => {
    const q = (req.query as Record<string, string>) ?? {};
    let qb = db('projects').where({ tenant_id: req.user.tid });
    if (q.customer) qb = qb.where('customer_id', q.customer);
    if (q.q) {
      const like = `%${q.q.toLowerCase()}%`;
      qb = qb.andWhere(function () {
        this.whereRaw('LOWER(name) LIKE ?', [like])
          .orWhereRaw('LOWER(code) LIKE ?', [like])
          .orWhereRaw('LOWER(COALESCE(client_name, \'\')) LIKE ?', [like]);
      });
    }
    const rows = await qb.orderBy('name', 'asc');
    const cMap = await hydrateCustomers(rows, req.user.tid);
    return rows.map((r: any) => shape(r, cMap.get(r.customer_id)));
  });

  app.post('/projects', async (req) => {
    if (!canManage(req.user.role)) throw forbidden('manager or admin required');
    const parsed = projectCreateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('invalid_request', 'Invalid project payload', parsed.error.flatten());
    const exists = await db('projects').where({ tenant_id: req.user.tid, code: parsed.data.code }).first();
    if (exists) throw unprocessable('Project code already exists');

    // If customerId is supplied, verify it belongs to the same tenant.
    let customerId: string | null = null;
    if (parsed.data.customerId) {
      const customer = await db('customers')
        .where({ id: parsed.data.customerId, tenant_id: req.user.tid })
        .first();
      if (!customer) throw notFound('Customer');
      customerId = customer.id;
    }

    const [row] = await db('projects')
      .insert({
        tenant_id: req.user.tid,
        name: parsed.data.name,
        code: parsed.data.code,
        description: parsed.data.description ?? null,
        status: parsed.data.status,
        start_date: parsed.data.startDate ?? null,
        end_date: parsed.data.endDate ?? null,
        color: parsed.data.color,
        client_name: parsed.data.clientName ?? null,
        customer_id: customerId,
        created_by: req.user.sub,
      })
      .returning('*');

    let customer: Record<string, any> | undefined;
    if (customerId) {
      customer = await db('customers').where({ id: customerId }).first();
    }
    await recordAudit(req, 'create', 'project', row.id, {
      after: {
        name: row.name,
        code: row.code,
        status: row.status,
        color: row.color,
        customerId: row.customer_id,
        clientName: row.client_name,
      },
    });
    return shape(row, customer);
  });

  app.get<{ Params: { id: string } }>('/projects/:id', async (req) => {
    const row = await db('projects').where({ id: req.params.id, tenant_id: req.user.tid }).first();
    if (!row) throw notFound('Project');

    const [members, customer] = await Promise.all([
      db('project_members as pm')
        .join('users as u', 'u.id', 'pm.user_id')
        .where('pm.project_id', req.params.id)
        .select('u.id', 'u.full_name', 'u.email', 'u.role', 'u.avatar_url', 'pm.role_in_project'),
      row.customer_id ? db('customers').where({ id: row.customer_id }).first() : Promise.resolve(null),
    ]);

    return {
      ...shape(row, customer ?? undefined),
      members: members.map((m) => ({
        id: m.id,
        fullName: m.full_name,
        email: m.email,
        role: m.role,
        avatarUrl: m.avatar_url,
        roleInProject: m.role_in_project,
      })),
    };
  });

  app.patch<{ Params: { id: string } }>('/projects/:id', async (req) => {
    if (!canManage(req.user.role)) throw forbidden('manager or admin required');
    const parsed = projectUpdateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('invalid_request', 'Invalid update payload', parsed.error.flatten());
    const existing = await db('projects').where({ id: req.params.id, tenant_id: req.user.tid }).first();
    if (!existing) throw notFound('Project');

    const patch: Record<string, unknown> = { updated_at: db.fn.now() };
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.code !== undefined) patch.code = parsed.data.code;
    if (parsed.data.description !== undefined) patch.description = parsed.data.description;
    if (parsed.data.status !== undefined) patch.status = parsed.data.status;
    if (parsed.data.startDate !== undefined) patch.start_date = parsed.data.startDate;
    if (parsed.data.endDate !== undefined) patch.end_date = parsed.data.endDate;
    if (parsed.data.color !== undefined) patch.color = parsed.data.color;
    if (parsed.data.clientName !== undefined) patch.client_name = parsed.data.clientName;
    if (parsed.data.customerId !== undefined) {
      if (parsed.data.customerId === null) {
        patch.customer_id = null;
      } else {
        const customer = await db('customers')
          .where({ id: parsed.data.customerId, tenant_id: req.user.tid })
          .first();
        if (!customer) throw notFound('Customer');
        patch.customer_id = customer.id;
      }
    }

    await db('projects').where({ id: req.params.id }).update(patch);
    const row = await db('projects').where({ id: req.params.id }).first();
    let customer: Record<string, any> | undefined;
    if (row.customer_id) {
      customer = await db('customers').where({ id: row.customer_id }).first();
    }
    await recordAudit(req, 'update', 'project', row.id, {
      diff: {
        name: { from: existing.name, to: row.name },
        code: { from: existing.code, to: row.code },
        status: { from: existing.status, to: row.status },
        color: { from: existing.color, to: row.color },
        customerId: { from: existing.customer_id, to: row.customer_id },
        clientName: { from: existing.client_name, to: row.client_name },
      },
    });
    return shape(row, customer);
  });

  app.post<{ Params: { id: string } }>('/projects/:id/members', async (req) => {
    if (!canManage(req.user.role)) throw forbidden('manager or admin required');
    const parsed = addMemberSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('invalid_request', 'Invalid member payload', parsed.error.flatten());
    const proj = await db('projects').where({ id: req.params.id, tenant_id: req.user.tid }).first();
    if (!proj) throw notFound('Project');
    const user = await db('users').where({ id: parsed.data.userId, tenant_id: req.user.tid }).first();
    if (!user) throw notFound('User');
    const existingMember = await db('project_members')
      .where({ project_id: req.params.id, user_id: parsed.data.userId })
      .first();
    await db('project_members')
      .insert({
        project_id: req.params.id,
        user_id: parsed.data.userId,
        role_in_project: parsed.data.roleInProject,
      })
      .onConflict(['project_id', 'user_id'])
      .merge({ role_in_project: parsed.data.roleInProject });
    // entity_id is a uuid column; the (projectId, userId) composite doesn't fit.
    // Use the user_id as the row identity and store the projectId in the payload
    // — describeEntity() reads projectId from the payload to resolve the link.
    await recordAudit(
      req,
      existingMember ? 'update' : 'create',
      'project_member',
      parsed.data.userId,
      {
        projectId: req.params.id,
        userId: parsed.data.userId,
        userName: user.full_name,
        roleInProject: parsed.data.roleInProject,
        previousRole: existingMember?.role_in_project ?? null,
      }
    );
    return { ok: true };
  });

  app.delete<{ Params: { id: string; userId: string } }>(
    '/projects/:id/members/:userId',
    async (req) => {
      if (!canManage(req.user.role)) throw forbidden('manager or admin required');
      const existing = await db('project_members')
        .where({ project_id: req.params.id, user_id: req.params.userId })
        .first();
      if (!existing) return { ok: true };
      await db('project_members')
        .where({ project_id: req.params.id, user_id: req.params.userId })
        .delete();
      const user = await db('users').where({ id: req.params.userId }).first();
      await recordAudit(req, 'delete', 'project_member', req.params.userId, {
        projectId: req.params.id,
        userId: req.params.userId,
        userName: user?.full_name ?? null,
        roleInProject: existing.role_in_project,
      });
      return { ok: true };
    }
  );
}
