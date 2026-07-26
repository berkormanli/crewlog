import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { canManage } from '../../lib/jwt.js';
import { badRequest, forbidden, notFound, unprocessable } from '../../lib/errors.js';
import { recordAudit } from '../../lib/audit.js';

const customerCreateSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().max(50).optional(),
  contactName: z.string().max(200).optional(),
  contactEmail: z.string().email().max(200).optional().or(z.literal('')).transform((v) => (v ? v : undefined)),
  contactPhone: z.string().max(50).optional(),
  address: z.string().max(500).optional(),
  notes: z.string().max(5000).optional(),
  status: z.enum(['active', 'archived']).default('active'),
});

const customerUpdateSchema = customerCreateSchema.partial();

function shape(row: Record<string, any>) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    code: row.code,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    address: row.address,
    notes: row.notes,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function customerRoutes(app: FastifyInstance) {
  // LIST — all authenticated users can see customers so projects can label themselves
  app.get('/customers', async (req) => {
    const q = (req.query as Record<string, string>) ?? {};
    let qb = db('customers').where({ tenant_id: req.user.tid });
    if (q.status) qb = qb.where('status', q.status);
    if (q.q) {
      const like = `%${q.q.toLowerCase()}%`;
      qb = qb.andWhere(function () {
        this.whereRaw('LOWER(name) LIKE ?', [like])
          .orWhereRaw('LOWER(COALESCE(code, \'\')) LIKE ?', [like])
          .orWhereRaw('LOWER(COALESCE(contact_name, \'\')) LIKE ?', [like]);
      });
    }
    const rows = await qb.orderBy('name', 'asc');
    return rows.map(shape);
  });

  app.post('/customers', async (req) => {
    if (!canManage(req.user.role)) throw forbidden('manager or admin required');
    const parsed = customerCreateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('invalid_request', 'Invalid customer payload', parsed.error.flatten());
    const [row] = await db('customers')
      .insert({
        tenant_id: req.user.tid,
        name: parsed.data.name,
        code: parsed.data.code ?? null,
        contact_name: parsed.data.contactName ?? null,
        contact_email: parsed.data.contactEmail ?? null,
        contact_phone: parsed.data.contactPhone ?? null,
        address: parsed.data.address ?? null,
        notes: parsed.data.notes ?? null,
        status: parsed.data.status,
        created_by: req.user.sub,
      })
      .returning('*');
    await recordAudit(req, 'create', 'customer', row.id, {
      after: {
        name: row.name,
        code: row.code,
        contactName: row.contact_name,
        contactEmail: row.contact_email,
        status: row.status,
      },
    });
    return shape(row);
  });

  app.get<{ Params: { id: string } }>('/customers/:id', async (req) => {
    const row = await db('customers').where({ id: req.params.id, tenant_id: req.user.tid }).first();
    if (!row) throw notFound('Customer');

    // Include bound projects so the detail page can show "projects for this customer".
    const projects = await db('projects')
      .where({ tenant_id: req.user.tid, customer_id: row.id })
      .orderBy('name', 'asc')
      .select('id', 'name', 'code', 'color', 'status');

    return {
      ...shape(row),
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        code: p.code,
        color: p.color,
        status: p.status,
      })),
    };
  });

  app.patch<{ Params: { id: string } }>('/customers/:id', async (req) => {
    if (!canManage(req.user.role)) throw forbidden('manager or admin required');
    const parsed = customerUpdateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('invalid_request', 'Invalid update payload', parsed.error.flatten());
    const existing = await db('customers').where({ id: req.params.id, tenant_id: req.user.tid }).first();
    if (!existing) throw notFound('Customer');

    const patch: Record<string, unknown> = { updated_at: db.fn.now() };
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.code !== undefined) patch.code = parsed.data.code;
    if (parsed.data.contactName !== undefined) patch.contact_name = parsed.data.contactName;
    if (parsed.data.contactEmail !== undefined) patch.contact_email = parsed.data.contactEmail;
    if (parsed.data.contactPhone !== undefined) patch.contact_phone = parsed.data.contactPhone;
    if (parsed.data.address !== undefined) patch.address = parsed.data.address;
    if (parsed.data.notes !== undefined) patch.notes = parsed.data.notes;
    if (parsed.data.status !== undefined) patch.status = parsed.data.status;

    await db('customers').where({ id: req.params.id }).update(patch);
    const row = await db('customers').where({ id: req.params.id }).first();
    const tracked = ['name', 'code', 'contact_name', 'contact_email', 'contact_phone', 'address', 'notes', 'status'];
    const diff: Record<string, { from: any; to: any }> = {};
    for (const f of tracked) {
      const a = (existing as any)[f];
      const b = (row as any)[f];
      if (a !== b) diff[f] = { from: a, to: b };
    }
    if (Object.keys(diff).length > 0) {
      await recordAudit(req, 'update', 'customer', row.id, { diff });
    }
    return shape(row);
  });

  app.delete<{ Params: { id: string } }>('/customers/:id', async (req) => {
    if (!canManage(req.user.role)) throw forbidden('manager or admin required');
    const existing = await db('customers').where({ id: req.params.id, tenant_id: req.user.tid }).first();
    if (!existing) throw notFound('Customer');

    // Block deletion if any project still references the customer — unbind them first.
    const boundCount = await db('projects')
      .where({ tenant_id: req.user.tid, customer_id: req.params.id })
      .count<{ count: string }[]>('id as count')
      .first();
    if (boundCount && Number(boundCount.count) > 0) {
      throw unprocessable(
        `Cannot delete: ${boundCount.count} project(s) still bound to this customer. Unbind or delete them first.`
      );
    }
    await db('customers').where({ id: req.params.id }).delete();
    await recordAudit(req, 'delete', 'customer', req.params.id, {
      before: { name: existing.name, code: existing.code },
    });
    return { ok: true };
  });
}