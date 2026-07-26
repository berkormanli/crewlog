import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { canManage } from '../../lib/jwt.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { recordAudit } from '../../lib/audit.js';

/**
 * Sentinel value rendered in the dropdown as "Other…". When the worker
 * picks it, the UI surfaces a free-text input. The chosen value is
 * stored in `module_other`, `activity_type_other`, or `location_other`
 * columns on the work_log row (NOT the lookup table), so tenants can't
 * accidentally collide with it.
 */
export const OTHER_SENTINEL = '__other__';

function shape(row: Record<string, any>) {
  return {
    id: row.id,
    name: row.name,
    isDefault: !!row.is_default,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const upsertSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

/**
 * Shared CRUD logic for work modules, activity types, and work locations.
 * Same shape, same rules, so the only thing that changes is the table
 * name — keeps the route surface small.
 */
function registerLookupRoutes(
  app: FastifyInstance,
  table: 'work_modules' | 'work_activity_types' | 'work_locations',
  auditEntity: 'work_module' | 'work_activity_type' | 'work_location'
) {
  // Any authenticated user can LIST the lookups (the activity-log
  // dropdown is shown to everyone, not just managers).
  app.get(`/${table}`, async (req) => {
    const rows = await db(table)
      .where({ tenant_id: req.user.tid })
      .orderBy('is_default', 'desc')
      .orderBy('name', 'asc');
    return rows.map(shape);
  });

  // Manager+ only for create / update / delete — workers consume the
  // list but don't curate it.
  const requireManager = async (req: any) => {
    if (!canManage(req.user.role)) throw forbidden('manager or admin required');
  };

  app.post(`/${table}`, { preHandler: requireManager }, async (req) => {
    const parsed = upsertSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest('invalid_request', 'Invalid lookup payload', parsed.error.flatten());
    }
    if (parsed.data.name.toLowerCase() === OTHER_SENTINEL) {
      throw badRequest('reserved_name', `"${OTHER_SENTINEL}" is a reserved name`);
    }
    const existing = await db(table)
      .where({ tenant_id: req.user.tid })
      .whereRaw('LOWER(name) = ?', [parsed.data.name.toLowerCase()])
      .first();
    if (existing) throw badRequest('duplicate', 'A lookup with that name already exists');
    const [row] = await db(table)
      .insert({
        tenant_id: req.user.tid,
        name: parsed.data.name,
        is_default: false,
        created_by: req.user.sub,
      })
      .returning('*');
    await recordAudit(req, 'create', auditEntity, row.id, { after: { name: row.name } });
    return shape(row);
  });

  app.patch<{ Params: { id: string } }>(`/${table}/:id`, { preHandler: requireManager }, async (req) => {
    const parsed = upsertSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest('invalid_request', 'Invalid lookup payload', parsed.error.flatten());
    }
    if (parsed.data.name.toLowerCase() === OTHER_SENTINEL) {
      throw badRequest('reserved_name', `"${OTHER_SENTINEL}" is a reserved name`);
    }
    const existing = await db(table).where({ id: req.params.id, tenant_id: req.user.tid }).first();
    if (!existing) throw notFound('Lookup');
    const dupe = await db(table)
      .where({ tenant_id: req.user.tid })
      .whereRaw('LOWER(name) = ?', [parsed.data.name.toLowerCase()])
      .whereNot({ id: req.params.id })
      .first();
    if (dupe) throw badRequest('duplicate', 'A lookup with that name already exists');
    await db(table).where({ id: req.params.id }).update({
      name: parsed.data.name,
      updated_at: db.fn.now(),
    });
    const row = await db(table).where({ id: req.params.id }).first();
    await recordAudit(req, 'update', auditEntity, row.id, {
      diff: { name: { from: existing.name, to: row.name } },
    });
    return shape(row);
  });

  app.delete<{ Params: { id: string } }>(`/${table}/:id`, { preHandler: requireManager }, async (req) => {
    const existing = await db(table).where({ id: req.params.id, tenant_id: req.user.tid }).first();
    if (!existing) throw notFound('Lookup');
    if (existing.is_default) {
      throw badRequest('default_protected', 'Default lookups cannot be deleted');
    }
    await db(table).where({ id: req.params.id }).delete();
    await recordAudit(req, 'delete', auditEntity, req.params.id, { before: { name: existing.name } });
    return { ok: true };
  });
}

export async function lookupRoutes(app: FastifyInstance) {
  registerLookupRoutes(app, 'work_modules', 'work_module');
  registerLookupRoutes(app, 'work_activity_types', 'work_activity_type');
  registerLookupRoutes(app, 'work_locations', 'work_location');
}
