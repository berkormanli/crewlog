import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import crypto from 'node:crypto';
import { db } from '../../db/index.js';
import { verifyPassword } from '../../lib/password.js';
import { badRequest, unauthorized } from '../../lib/errors.js';
import { config } from '../../config.js';
import { signAccessToken, signRefreshToken, verifyToken, type AuthPayload } from '../../lib/jwt.js';
import { detectTimezoneFromIp, isValidTimezone } from '../../lib/timezone.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  // Optional: the browser-detected IANA timezone (e.g. "Europe/Istanbul").
  // Stored on the user row on first login if no timezone is set yet.
  timezone: z.string().max(100).optional(),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

function parseTtlToMs(ttl: string): number {
  const m = ttl.match(/^(\d+)([smhd])$/);
  if (!m) return 15 * 60 * 1000;
  const n = Number(m[1]);
  const unit = m[2];
  return n * { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit as 's' | 'm' | 'h' | 'd'];
}

async function issueTokens(app: FastifyInstance, user: AuthPayload) {
  // Include a per-token jti so two tokens generated in the same second for the
  // same user don't collide on the SHA-256 hash in the refresh_tokens table.
  const jti = crypto.randomUUID();
  const access = await signAccessToken(app, { ...user, jti } as any);
  const refresh = await signRefreshToken(app, { ...user, jti } as any);
  return { access, refresh };
}

async function persistRefresh(userId: string, refreshToken: string) {
  const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  const expiresAt = new Date(Date.now() + parseTtlToMs(config.jwt.refreshTtl));
  await db('refresh_tokens').insert({
    user_id: userId,
    token_hash: hash,
    expires_at: expiresAt,
  });
}

export async function authRoutes(app: FastifyInstance) {
  app.post(
    '/auth/login',
    {
      config: {
        rateLimit: {
          max: config.rateLimit.authMax,
          timeWindow: config.rateLimit.authWindow,
        },
      },
    },
    async (req) => {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) throw badRequest('invalid_request', 'Invalid login payload', parsed.error.flatten());
      const { email, password, timezone } = parsed.data;

      const user = await db('users').where({ email }).where('is_active', true).first();
      if (!user) throw unauthorized('Invalid email or password');

      const ok = await verifyPassword(user.password_hash, password);
      if (!ok) throw unauthorized('Invalid email or password');

      // ---- First-login timezone capture ----
      //
      // The preference order is:
      //   1. The browser-reported timezone (most accurate; the user's
      //      actual machine clock wins).
      //   2. An IP-based lookup (covers the case where the browser doesn't
      //      expose a usable timezone, e.g. a stale browser).
      //   3. Leave the existing value alone if we get nothing useful.
      //
      // We only WRITE on a "first login" — once the user has explicitly
      // picked a timezone (or anything else is set), we don't stomp on it.
      // We treat "not set / default UTC" as "first login".
      let resolvedTimezone: string | null = user.timezone ?? null;
      const isFirstLogin = !resolvedTimezone || resolvedTimezone === 'UTC';
      if (isFirstLogin) {
        if (timezone && isValidTimezone(timezone)) {
          resolvedTimezone = timezone;
        } else {
          const detected = await detectTimezoneFromIp(req);
          if (detected && isValidTimezone(detected.timezone)) {
            resolvedTimezone = detected.timezone;
          }
        }
      }

      const update: Record<string, unknown> = { last_login_at: db.fn.now() };
      if (isFirstLogin && resolvedTimezone) {
        update.timezone = resolvedTimezone;
      }
      await db('users').where({ id: user.id }).update(update);

      const payload: AuthPayload = {
        sub: user.id,
        tid: user.tenant_id,
        role: user.role,
        email: user.email,
        name: user.full_name,
      };

      const tokens = await issueTokens(app, payload);
      await persistRefresh(user.id, tokens.refresh);

      return {
        user: {
          id: user.id,
          email: user.email,
          fullName: user.full_name,
          role: user.role,
          avatarUrl: user.avatar_url,
          tenantId: user.tenant_id,
          defaultDailyHours: Number(user.default_daily_hours ?? 8),
          timezone: resolvedTimezone ?? user.timezone ?? 'UTC',
        },
        settings: {
          backdateWindowDays: config.backdateWindowDays,
        },
        ...tokens,
      };
    }
  );

  app.post('/auth/refresh', async (req) => {
    const parsed = refreshSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('invalid_request', 'Invalid refresh payload');
    const { refreshToken } = parsed.data;
    const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');

    const row = await db('refresh_tokens').where({ token_hash: hash }).first();
    if (!row || row.revoked_at || new Date(row.expires_at) < new Date()) {
      throw unauthorized('Invalid refresh token');
    }

    let decoded: AuthPayload;
    try {
      decoded = await verifyToken(app, refreshToken);
      if (decoded.kind !== 'refresh') throw new Error('not a refresh token');
    } catch {
      throw unauthorized('Invalid refresh token');
    }

    const user = await db('users').where({ id: decoded.sub }).first();
    if (!user || !user.is_active) throw unauthorized('User inactive');

    await db('refresh_tokens').where({ id: row.id }).update({ revoked_at: db.fn.now() });
    const tokens = await issueTokens(app, decoded);
    await persistRefresh(decoded.sub, tokens.refresh);

    return tokens;
  });

  app.post('/auth/logout', async (req) => {
    const body = (req.body ?? {}) as { refreshToken?: string };
    if (body.refreshToken) {
      const hash = crypto.createHash('sha256').update(body.refreshToken).digest('hex');
      await db('refresh_tokens').where({ token_hash: hash }).update({ revoked_at: db.fn.now() });
    }
    return { ok: true };
  });

  app.get('/auth/me', async (req) => {
    const u = req.user;
    const row = await db('users').where({ id: u.sub }).first();
    if (!row) throw unauthorized();
    return {
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      role: row.role,
      avatarUrl: row.avatar_url,
      tenantId: row.tenant_id,
      defaultDailyHours: Number(row.default_daily_hours ?? 8),
      timezone: row.timezone ?? 'UTC',
      backdateWindowDays: config.backdateWindowDays,
    };
  });
}
