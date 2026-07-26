import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { isoDate } from '../../lib/dates.js';
import { recordAudit } from '../../lib/audit.js';

const upsertSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expectedHours: z.number().gt(0).max(24),
});

/**
 * Per-day override of a worker's expected hours. When set, this takes
 * precedence over `users.default_daily_hours` for that specific date.
 *
 * Workers can set/clear their own overrides. Managers can set overrides for
 * anyone in their tenant (handy for things like "today is a half day").
 */
export async function capacityRoutes(app: FastifyInstance) {
  app.get('/capacity/me', async (req) => {
    const q = req.query as Record<string, string>;
    const from = q.from;
    const to = q.to;

    const overrides = await db('daily_capacity')
      .where({ tenant_id: req.user.tid, worker_id: req.user.sub })
      .modify((qb) => {
        if (from) qb.where('date', '>=', from);
        if (to) qb.where('date', '<=', to);
      })
      .orderBy('date', 'asc');

    const u = await db('users').where({ id: req.user.sub }).first();
    const defaultHours = Number(u?.default_daily_hours ?? 8);

    return {
      workerId: req.user.sub,
      defaultDailyHours: defaultHours,
      overrides: overrides.map((r: any) => ({
        id: r.id,
        date: isoDate(r.date),
        expectedHours: Number(r.expected_hours),
        setBy: r.set_by,
        updatedAt: r.updated_at,
      })),
    };
  });

  app.put('/capacity/me/:date', async (req) => {
    const date = (req.params as { date: string }).date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw badRequest('invalid_date', 'date must be YYYY-MM-DD');
    }
    const parsed = upsertSchema.safeParse({ ...(req.body as object), date });
    if (!parsed.success) throw badRequest('invalid_request', 'Invalid payload', parsed.error.flatten());

    const before = await db('daily_capacity')
      .where({ worker_id: req.user.sub, date: parsed.data.date })
      .first();

    await db('daily_capacity')
      .insert({
        tenant_id: req.user.tid,
        worker_id: req.user.sub,
        date: parsed.data.date,
        expected_hours: parsed.data.expectedHours,
        set_by: req.user.sub,
      })
      .onConflict(['worker_id', 'date'])
      .merge({
        expected_hours: parsed.data.expectedHours,
        set_by: req.user.sub,
        updated_at: db.fn.now(),
      });

    const row = await db('daily_capacity')
      .where({ worker_id: req.user.sub, date: parsed.data.date })
      .first();

    await recordAudit(req, before ? 'update' : 'create', 'capacity_override', row.id, {
      date: parsed.data.date,
      workerId: req.user.sub,
      diff: before
        ? { expectedHours: { from: Number(before.expected_hours), to: Number(row.expected_hours) } }
        : { expectedHours: { from: null, to: Number(row.expected_hours) } },
    });

    return {
      date: parsed.data.date,
      expectedHours: Number(row.expected_hours),
    };
  });

  app.delete('/capacity/me/:date', async (req) => {
    const date = (req.params as { date: string }).date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw badRequest('invalid_date', 'date must be YYYY-MM-DD');
    }
    const existing = await db('daily_capacity')
      .where({ worker_id: req.user.sub, date })
      .first();
    const deleted = await db('daily_capacity')
      .where({ worker_id: req.user.sub, date })
      .delete();
    if (!deleted) throw notFound('Capacity override');
    await recordAudit(req, 'delete', 'capacity_override', existing.id, {
      date,
      workerId: req.user.sub,
      before: { expectedHours: Number(existing.expected_hours) },
    });
    return { ok: true };
  });
}