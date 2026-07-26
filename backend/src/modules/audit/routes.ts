import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { canManage } from '../../lib/jwt.js';
import { forbidden } from '../../lib/errors.js';

const listQuerySchema = z.object({
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  actor: z.string().optional(),
  action: z.string().optional(),
  from: z.string().optional(), // YYYY-MM-DD
  to: z.string().optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  before: z.string().optional(), // cursor (createdAt ISO + id) for pagination
});

interface Row {
  id: string;
  tenant_id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  payload: any;
  created_at: string;
}

/**
 * Human-readable label for the entity the action targeted, so the admin /
 * manager activity feed can show e.g. "Alex Manager updated project
 * Riverside Tower Build" without an extra lookup per row.
 *
 * Best-effort and tenant-scoped — unknown entities simply return null and
 * the UI falls back to the entity id.
 */
export async function describeEntity(
  entityType: string | null | undefined,
  entityId: string | null | undefined,
  tenantId: string
): Promise<{ label: string; href: string | null } | null> {
  if (!entityType || !entityId) return null;
  switch (entityType) {
    case 'project': {
      const row = await db('projects')
        .where({ id: entityId, tenant_id: tenantId })
        .select('id', 'name')
        .first();
      if (!row) return null;
      return { label: row.name, href: `/projects/${row.id}` };
    }
    case 'project_member': {
      // entity_id is the userId (we don't store composite ids in entity_id
      // because it's a uuid column). The project id is in the payload, so we
      // fall back to a direct lookup when the caller didn't supply it.
      let projectId = entityId;
      // entityId here is the user id (see project/routes.ts). For a member
      // row, we know the project from the payload via a second pass if needed;
      // but describeEntity() is intentionally signature-lightweight, so we
      // do a follow-up lookup ourselves: any project where this user is a
      // member. For tenants with many projects this is fine — the page size
      // is small.
      const row = await db('project_members as pm')
        .join('projects as p', 'p.id', 'pm.project_id')
        .where({ 'pm.user_id': entityId, 'p.tenant_id': tenantId })
        .select('p.id', 'p.name')
        .orderBy('pm.project_id', 'asc')
        .first();
      if (!row) {
        void projectId;
        return null;
      }
      return { label: row.name, href: `/projects/${row.id}` };
    }
    case 'task': {
      const row = await db('tasks')
        .where({ id: entityId, tenant_id: tenantId })
        .select('id', 'title', 'project_id')
        .first();
      if (!row) return null;
      return { label: row.title, href: `/tasks/${row.id}` };
    }
    case 'task_comment': {
      const row = await db('task_comments as c')
        .leftJoin('tasks as t', 't.id', 'c.task_id')
        .where('c.id', entityId)
        .select('c.task_id', 't.title as title', 't.tenant_id')
        .first();
      if (!row || row.tenant_id !== tenantId) return null;
      return { label: row.title ?? 'Task', href: `/tasks/${row.task_id}` };
    }
    case 'task_request': {
      const row = await db('task_requests')
        .where({ id: entityId, tenant_id: tenantId })
        .select('id', 'title')
        .first();
      if (!row) return null;
      return { label: row.title, href: `/tasks/requests` };
    }
    case 'document': {
      const row = await db('documents')
        .where({ id: entityId, tenant_id: tenantId })
        .select('id', 'name')
        .first();
      if (!row) return null;
      return { label: row.name, href: `/documents` };
    }
    case 'folder': {
      const row = await db('folders')
        .where({ id: entityId, tenant_id: tenantId })
        .select('id', 'name')
        .first();
      if (!row) return null;
      return { label: row.name, href: `/documents` };
    }
    case 'customer': {
      const row = await db('customers')
        .where({ id: entityId, tenant_id: tenantId })
        .select('id', 'name')
        .first();
      if (!row) return null;
      return { label: row.name, href: `/customers/${row.id}` };
    }
    case 'work_log': {
      return null; // work logs are surfaced through the timesheet, not a detail page.
    }
    case 'capacity_override': {
      // entity_id is the override row id; payload carries the date.
      return null;
    }
    case 'user': {
      const row = await db('users')
        .where({ id: entityId, tenant_id: tenantId })
        .select('id', 'full_name')
        .first();
      if (!row) return null;
      return { label: row.full_name, href: `/admin/users` };
    }
    default:
      return null;
  }
}

export async function auditRoutes(app: FastifyInstance) {
  // Guard every endpoint: manager+ only.
  app.addHook('preHandler', async (req) => {
    if (!canManage(req.user.role)) throw forbidden('manager or admin required');
  });

  /**
   * `GET /audit-log` — paginated, filterable activity feed.
   * Cursor pagination uses (created_at DESC, id DESC) so the client can simply
   * pass the previous page's tail row id back via `before=`.
   */
  app.get('/audit-log', async (req) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return { error: { code: 'invalid_request', message: 'Invalid query', details: parsed.error.flatten() } };
    }
    const q = parsed.data;

    let qb = db('audit_log').where({ tenant_id: req.user.tid });

    if (q.entityType) qb = qb.where('entity_type', q.entityType);
    if (q.entityId) qb = qb.where('entity_id', q.entityId);
    if (q.actor) qb = qb.where('actor_id', q.actor);
    if (q.action) qb = qb.where('action', q.action);
    if (q.from) qb = qb.where('created_at', '>=', `${q.from}T00:00:00Z`);
    if (q.to) qb = qb.where('created_at', '<=', `${q.to}T23:59:59.999Z`);

    if (q.q) {
      const like = `%${q.q.toLowerCase()}%`;
      // Search the JSONB payload's text form so plain-text matches against
      // entity labels / changes also work.
      qb = qb.andWhere(function () {
        this.whereRaw('LOWER(COALESCE(action, \'\')) LIKE ?', [like]).orWhereRaw(
          'LOWER(payload::text) LIKE ?',
          [like]
        );
      });
    }

    if (q.before) {
      // cursor decode: "<createdAtIso>|<id>"
      const at = q.before.indexOf('|');
      if (at > 0) {
        const cursorDate = q.before.slice(0, at);
        const cursorId = q.before.slice(at + 1);
        qb = qb.where(function () {
          this.where('created_at', '<', cursorDate).orWhere(function () {
            this.where('created_at', '=', cursorDate).andWhere('id', '<', cursorId);
          });
        });
      }
    }

    const rows: Row[] = await qb
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(q.limit + 1); // +1 to compute "has more"

    const hasMore = rows.length > q.limit;
    const page = hasMore ? rows.slice(0, q.limit) : rows;
    const nextCursor = hasMore ? `${page[page.length - 1].created_at}|${page[page.length - 1].id}` : null;

    // Hydrate actors (left join) + entity labels (best-effort lookup per row;
    // bounded by the page limit).
    const actorIds = Array.from(new Set(page.map((r) => r.actor_id).filter(Boolean) as string[]));
    const actorRows = actorIds.length
      ? await db('users')
          .whereIn('id', actorIds)
          .select('id', 'full_name', 'email', 'role', 'avatar_url')
      : [];
    const actorMap = new Map(actorRows.map((u: any) => [u.id, u]));

    const items = await Promise.all(
      page.map(async (r) => {
        const entity = await describeEntity(r.entity_type, r.entity_id, req.user.tid);
        return {
          id: r.id,
          actorId: r.actor_id,
          actor: r.actor_id
            ? {
                id: r.actor_id,
                fullName: actorMap.get(r.actor_id)?.full_name ?? 'Unknown user',
                email: actorMap.get(r.actor_id)?.email ?? null,
                role: actorMap.get(r.actor_id)?.role ?? null,
                avatarUrl: actorMap.get(r.actor_id)?.avatar_url ?? null,
              }
            : null,
          action: r.action,
          entityType: r.entity_type,
          entityId: r.entity_id,
          entity,
          payload: typeof r.payload === 'string' ? safeParse(r.payload) : r.payload,
          createdAt: r.created_at,
        };
      })
    );

    return { items, nextCursor, hasMore };
  });

  /**
   * `GET /audit-log/filters` — distinct entity types + actions + recent actors
   * present in this tenant's audit log. Used to populate the filter UI.
   */
  app.get('/audit-log/filters', async (req) => {
    const [entityTypes, actions, actors] = await Promise.all([
      db('audit_log')
        .where({ tenant_id: req.user.tid })
        .distinct('entity_type as entity_type')
        .orderBy('entity_type'),
      db('audit_log')
        .where({ tenant_id: req.user.tid })
        .distinct('action as action')
        .orderBy('action'),
      db('audit_log as al')
        .leftJoin('users as u', 'u.id', 'al.actor_id')
        .where('al.tenant_id', req.user.tid)
        .groupBy('al.actor_id', 'u.full_name', 'u.email', 'u.role', 'u.avatar_url')
        .select('al.actor_id as id', 'u.full_name as fullName', 'u.email as email', 'u.role as role', 'u.avatar_url as avatarUrl')
        .orderBy('u.full_name', 'asc'),
    ]);

    return {
      entityTypes: entityTypes.map((e: any) => e.entity_type),
      actions: actions.map((a: any) => a.action),
      actors: actors.filter((a: any) => a.id),
    };
  });
}

function safeParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
