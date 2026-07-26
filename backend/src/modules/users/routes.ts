import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { badRequest, forbidden, notFound, unprocessable, unauthorized } from '../../lib/errors.js';
import { canManage } from '../../lib/jwt.js';
import { recordAudit } from '../../lib/audit.js';
import { isValidTimezone } from '../../lib/timezone.js';

const userCreateSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(1).max(200),
  role: z.enum(['worker', 'manager', 'admin']),
  avatarUrl: z.string().url().optional(),
  defaultDailyHours: z.number().gt(0).max(24).optional(),
});

const userUpdateSchema = z.object({
  fullName: z.string().min(1).max(200).optional(),
  role: z.enum(['worker', 'manager', 'admin']).optional(),
  avatarUrl: z.string().url().nullable().optional(),
  defaultDailyHours: z.number().gt(0).max(24).optional(),
});

/**
 * Self-service profile update — any authenticated user can change their
 * own name / timezone. We keep this separate from the manager-only
 * `/users/:id` patch so workers can update their own preferences
 * without us having to special-case role checks for `req.user.sub === id`.
 */
const selfUpdateSchema = z.object({
  fullName: z.string().min(1).max(200).optional(),
  timezone: z.string().max(100).optional(),
});

export async function userRoutes(app: FastifyInstance) {
  // Self-service: change own password. Available to any authenticated user.
  app.post('/auth/change-password', async (req) => {
    const body = z
      .object({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(8),
      })
      .safeParse(req.body);
    if (!body.success) throw badRequest('invalid_request', 'Invalid input');
    const u = await db('users').where({ id: req.user.sub }).first();
    if (!u) throw unauthorized();
    const ok = await verifyPassword(u.password_hash, body.data.currentPassword);
    if (!ok) throw badRequest('wrong_password', 'Current password is incorrect');
    const hash = await hashPassword(body.data.newPassword);
    await db('users').where({ id: u.id }).update({ password_hash: hash });
    return { ok: true };
  });

  // Self-service: update own name / timezone. Available to any authenticated user.
  app.patch('/auth/me', async (req) => {
    const parsed = selfUpdateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('invalid_request', 'Invalid payload', parsed.error.flatten());
    if (parsed.data.timezone !== undefined && !isValidTimezone(parsed.data.timezone)) {
      throw badRequest('invalid_timezone', 'Not a valid IANA timezone');
    }
    const existing = await db('users').where({ id: req.user.sub }).first();
    if (!existing) throw unauthorized();
    const patch: Record<string, unknown> = { updated_at: db.fn.now() };
    if (parsed.data.fullName !== undefined) patch.full_name = parsed.data.fullName;
    if (parsed.data.timezone !== undefined) patch.timezone = parsed.data.timezone;
    if (Object.keys(patch).length === 1) {
      return {
        id: existing.id,
        email: existing.email,
        fullName: existing.full_name,
        role: existing.role,
        avatarUrl: existing.avatar_url,
        tenantId: existing.tenant_id,
        defaultDailyHours: Number(existing.default_daily_hours ?? 8),
        timezone: existing.timezone ?? 'UTC',
      };
    }
    await db('users').where({ id: req.user.sub }).update(patch);
    const row = await db('users').where({ id: req.user.sub }).first();
    const diff: Record<string, { from: any; to: any }> = {};
    if (parsed.data.fullName !== undefined && parsed.data.fullName !== existing.full_name) {
      diff.full_name = { from: existing.full_name, to: parsed.data.fullName };
    }
    if (parsed.data.timezone !== undefined && parsed.data.timezone !== (existing.timezone ?? 'UTC')) {
      diff.timezone = { from: existing.timezone ?? null, to: parsed.data.timezone };
    }
    if (Object.keys(diff).length > 0) {
      await recordAudit(req, 'update', 'user', row.id, { diff, kind: 'self_update' });
    }
    return {
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      role: row.role,
      avatarUrl: row.avatar_url,
      tenantId: row.tenant_id,
      defaultDailyHours: Number(row.default_daily_hours ?? 8),
      timezone: row.timezone ?? 'UTC',
    };
  });

  // All endpoints below are manager+. We use a per-route preHandler
  // instead of `app.addHook('preHandler', ...)` because Fastify applies
  // plugin-level hooks to EVERY route registered in the same scope,
  // including the self-service routes above. Per-route preHandler keeps
  // the gate tight to the routes that actually need it.
  const requireManager = async (req: any) => {
    if (!canManage(req.user.role)) throw forbidden('manager or admin required');
  };

  app.get('/users', { preHandler: requireManager }, async (req) => {
    const q = (req.query as Record<string, string>) ?? {};
    const rows = await db('users')
      .where({ tenant_id: req.user.tid })
      .orderBy('full_name', 'asc')
      .select('id', 'email', 'full_name', 'role', 'avatar_url', 'is_active', 'last_login_at', 'created_at', 'default_daily_hours');
    const filtered = q.role ? rows.filter((r) => r.role === q.role) : rows;
    return filtered.map((r) => ({
      id: r.id,
      email: r.email,
      fullName: r.full_name,
      role: r.role,
      avatarUrl: r.avatar_url,
      isActive: r.is_active,
      lastLoginAt: r.last_login_at,
      createdAt: r.created_at,
      defaultDailyHours: Number(r.default_daily_hours),
    }));
  });

  app.post('/users', { preHandler: requireManager }, async (req) => {
    const parsed = userCreateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('invalid_request', 'Invalid user payload', parsed.error.flatten());

    const exists = await db('users').where({ tenant_id: req.user.tid, email: parsed.data.email }).first();
    if (exists) throw unprocessable('A user with that email already exists');

    const hash = await hashPassword(parsed.data.password);
    const [row] = await db('users')
      .insert({
        tenant_id: req.user.tid,
        email: parsed.data.email,
        password_hash: hash,
        full_name: parsed.data.fullName,
        role: parsed.data.role,
        avatar_url: parsed.data.avatarUrl ?? null,
        default_daily_hours: parsed.data.defaultDailyHours ?? 8,
      })
      .returning(['id', 'email', 'full_name', 'role', 'avatar_url', 'is_active', 'created_at', 'default_daily_hours']);
    await recordAudit(req, 'create', 'user', row.id, {
      after: {
        email: row.email,
        fullName: row.full_name,
        role: row.role,
        defaultDailyHours: Number(row.default_daily_hours),
      },
    });
    return {
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      role: row.role,
      avatarUrl: row.avatar_url,
      isActive: row.is_active,
      defaultDailyHours: Number(row.default_daily_hours),
    };
  });

  app.patch<{ Params: { id: string } }>('/users/:id', { preHandler: requireManager }, async (req) => {
    const parsed = userUpdateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('invalid_request', 'Invalid update payload', parsed.error.flatten());

    const existing = await db('users').where({ id: req.params.id, tenant_id: req.user.tid }).first();
    if (!existing) throw notFound('User');

    const patch: Record<string, unknown> = {};
    if (parsed.data.fullName !== undefined) patch.full_name = parsed.data.fullName;
    if (parsed.data.role !== undefined) patch.role = parsed.data.role;
    if (parsed.data.avatarUrl !== undefined) patch.avatar_url = parsed.data.avatarUrl;
    if (parsed.data.defaultDailyHours !== undefined) patch.default_daily_hours = parsed.data.defaultDailyHours;

    if (Object.keys(patch).length) {
      patch.updated_at = db.fn.now();
      await db('users').where({ id: req.params.id }).update(patch);
    }
    const row = await db('users').where({ id: req.params.id }).first();
    const tracked = ['full_name', 'role', 'avatar_url', 'default_daily_hours'];
    const diff: Record<string, { from: any; to: any }> = {};
    for (const f of tracked) {
      const a = (existing as any)[f];
      const b = (row as any)[f];
      if (a !== b) diff[f] = { from: a, to: b };
    }
    if (Object.keys(diff).length > 0) {
      await recordAudit(req, 'update', 'user', row.id, { diff });
    }
    return {
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      role: row.role,
      avatarUrl: row.avatar_url,
      isActive: row.is_active,
      defaultDailyHours: Number(row.default_daily_hours),
    };
  });

  app.post<{ Params: { id: string } }>('/users/:id/deactivate', { preHandler: requireManager }, async (req) => {
    const existing = await db('users').where({ id: req.params.id, tenant_id: req.user.tid }).first();
    if (!existing) throw notFound('User');
    await db('users').where({ id: req.params.id }).update({ is_active: false });
    await recordAudit(req, 'delete', 'user', req.params.id, {
      before: { email: existing.email, fullName: existing.full_name, role: existing.role },
      kind: 'deactivate',
    });
    return { ok: true };
  });
}
