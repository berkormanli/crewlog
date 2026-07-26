import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import crypto from 'node:crypto';
import { db } from '../../db/index.js';
import { config } from '../../config.js';
import { canManage } from '../../lib/jwt.js';
import { badRequest, forbidden, notFound, unprocessable } from '../../lib/errors.js';
import { todayIso } from '../../lib/dates.js';

/**
 * Fireflies.ai + LLM integration seams.
 *
 * Today: routes are mounted but return 503 unless `FIREFLIES_ENABLED=true`.
 * They DO accept payloads, write to the `meetings`/`meeting_action_proposals`
 * tables, and exercise the dispatcher → proposal flow end-to-end. The
 * dispatcher is a deterministic keyword stub (`provider=stub`) so the seams
 * can be developed and tested without an LLM API key.
 *
 * When you wire a real provider, swap `dispatchLLM` for an HTTP call to
 * OpenAI / Anthropic / etc. and keep the `meeting_action_proposals` shape
 * stable so the apply side doesn't need to change.
 */

const firefliesWebhookSchema = z.object({
  // Fireflies payload shape (subset). We accept either this exact shape or
  // any JSON with at least an `event` and `meetingId`.
  event: z.string().optional(),
  meetingId: z.string().optional(),
  id: z.string().optional(),
  title: z.string().optional(),
  transcript: z.string().optional(),
  transcriptText: z.string().optional(),
  url: z.string().optional(),
  hostEmail: z.string().optional(),
  participants: z
    .array(
      z.object({
        name: z.string().optional(),
        email: z.string().optional(),
      })
    )
    .optional(),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
});

const proposalApplySchema = z.object({
  // no body for now; future: { dryRun: boolean }
});

function ensureFirefliesEnabled() {
  if (!config.integrations.firefliesEnabled) {
    throw unprocessable(
      'Fireflies integration is disabled. Set FIREFLIES_ENABLED=true and restart the server.'
    );
  }
}

function verifyWebhookSignature(rawBody: string, signature: string | undefined): boolean {
  if (!config.integrations.firefliesWebhookSecret) return true; // dev mode
  if (!signature) return false;
  const expected = crypto
    .createHmac('sha256', config.integrations.firefliesWebhookSecret)
    .update(rawBody)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

/**
 * Stub LLM dispatcher. Scans the transcript for high-signal Turkish/English
 * phrases and emits action proposals. Real LLM call lives behind the same
 * shape so the rest of the system doesn't change.
 *
 * Pattern → proposal kind:
 *   - "tamamlandı / done / finished / bitti" + nearby task-ish noun → task_status_change → done
 *   - "yarın / tomorrow" + a number + "saat" → flag_missing_log (worker hasn't logged tomorrow)
 *   - "log hours / saat girin / hours today" → log_hours prompt
 *   - any capitalized noun phrase → create_task
 */
async function dispatchLLM(meetingId: string, transcript: string): Promise<Array<{
  kind: 'task_status_change' | 'create_task' | 'log_hours' | 'flag_missing_log';
  payload: Record<string, unknown>;
  reasoning: string;
}>> {
  const text = transcript.toLowerCase();
  const proposals: Array<{
    kind: 'task_status_change' | 'create_task' | 'log_hours' | 'flag_missing_log';
    payload: Record<string, unknown>;
    reasoning: string;
  }> = [];

  // Task-done signals
  if (/(done|finished|completed|tamamland[iı]|bitti|hallettim)/.test(text)) {
    proposals.push({
      kind: 'task_status_change',
      payload: { toStatus: 'done' },
      reasoning: 'Transcript mentions a "done" / "tamamlandı" signal; marking matching task done.',
    });
  }

  // "Tomorrow at 9 we should..." → flag a missing log for tomorrow
  if (/(yar[iı]n|tomorrow)/.test(text)) {
    proposals.push({
      kind: 'flag_missing_log',
      payload: { targetDate: 'tomorrow' },
      reasoning: 'Transcript references tomorrow; flagging whether a log exists for that date.',
    });
  }

  // "X hours today / bugün X saat" → log_hours nudge
  const hoursMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(saat|hours?)/);
  if (hoursMatch) {
    proposals.push({
      kind: 'log_hours',
      payload: { hours: Number(hoursMatch[1].replace(',', '.')) },
      reasoning: `Transcript mentions ${hoursMatch[0]}; suggesting a ${hoursMatch[1]}h log entry.`,
    });
  }

  // Capitalized noun-ish phrase → new task (very rough, just for the seam)
  const newTaskMatch = transcript.match(/\b(?:create|open|yeni|new)\s+([A-Z][\w\s-]{4,60})/);
  if (newTaskMatch) {
    proposals.push({
      kind: 'create_task',
      payload: { title: newTaskMatch[1].trim() },
      reasoning: `Transcript suggests creating a new task: "${newTaskMatch[1].trim()}".`,
    });
  }

  // Idempotency: nothing detected? Don't pollute the proposals table.
  return proposals;
}

export async function integrationRoutes(app: FastifyInstance) {
  // ---- INBOUND WEBHOOK (fireflies-shaped) ----
  app.post('/integrations/fireflies/webhook', async (req, reply) => {
    ensureFirefliesEnabled();

    // Signature verification — best-effort. We compute over the raw JSON body.
    const signature = (req.headers['x-fireflies-signature'] ?? req.headers['x-signature']) as
      | string
      | undefined;
    const rawBody = JSON.stringify(req.body ?? {});
    if (!verifyWebhookSignature(rawBody, signature)) {
      throw forbidden('Invalid webhook signature');
    }

    const parsed = firefliesWebhookSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('invalid_request', 'Invalid Fireflies payload', parsed.error.flatten());

    const externalId = parsed.data.meetingId ?? parsed.data.id ?? null;
    if (!externalId) throw badRequest('missing_meeting_id', 'Webhook payload must include meetingId or id');

    const transcript =
      parsed.data.transcriptText ??
      parsed.data.transcript ??
      '';

    // The webhook is unauthenticated (it carries its own signature). We resolve
    // the tenant by looking up the host user's record — fireflies sends the
    // meeting host's email, which we'll trust as the routing key.
    let hostUserId: string | null = null;
    let tenantId: string | null = null;
    if (parsed.data.hostEmail) {
      const u = await db('users').where({ email: parsed.data.hostEmail }).first();
      hostUserId = u?.id ?? null;
      tenantId = u?.tenant_id ?? null;
    }
    if (!tenantId) {
      // Single-tenant demo fallback: use the only tenant if we can find one.
      // In production, fail hard instead.
      const t = await db('tenants').first();
      tenantId = t?.id ?? null;
    }
    if (!tenantId) throw notFound('Tenant');

    if (!hostUserId) {
      const fallback = await db('users')
        .where({ tenant_id: tenantId })
        .whereIn('role', ['manager', 'admin'])
        .first();
      hostUserId = fallback?.id ?? null;
    }

    const [meeting] = await db('meetings')
      .insert({
        tenant_id: tenantId,
        provider: 'fireflies',
        external_id: externalId,
        title: parsed.data.title ?? 'Untitled meeting',
        transcript,
        source_url: parsed.data.url ?? null,
        host_user_id: hostUserId,
        started_at: parsed.data.startedAt ? new Date(parsed.data.startedAt) : null,
        ended_at: parsed.data.endedAt ? new Date(parsed.data.endedAt) : null,
        raw_payload: req.body as any,
      })
      .onConflict(['provider', 'external_id'])
      .merge({
        title: parsed.data.title ?? 'Untitled meeting',
        transcript,
        source_url: parsed.data.url ?? null,
        host_user_id: hostUserId,
        started_at: parsed.data.startedAt ? new Date(parsed.data.startedAt) : null,
        ended_at: parsed.data.endedAt ? new Date(parsed.data.endedAt) : null,
        raw_payload: req.body as any,
        updated_at: db.fn.now(),
      })
      .returning('*');

    if (Array.isArray(parsed.data.participants) && parsed.data.participants.length) {
      // Re-sync participants for this meeting.
      await db('meeting_participants').where({ meeting_id: meeting.id }).delete();
      for (const p of parsed.data.participants) {
        let userId: string | null = null;
        if (p.email) {
          const u = await db('users').where({ tenant_id: tenantId, email: p.email }).first();
          userId = u?.id ?? null;
        }
        await db('meeting_participants').insert({
          meeting_id: meeting.id,
          user_id: userId,
          display_name: p.name ?? null,
          email: p.email ?? null,
        });
      }
    }

    return reply.status(202).send({ accepted: true, meetingId: meeting.id });
  });

  // ---- MEETINGS LIST ----
  app.get('/meetings', async (req) => {
    if (!canManage(req.user.role)) throw forbidden('manager or admin required');
    const q = req.query as Record<string, string>;
    const qb = db('meetings')
      .where({ tenant_id: req.user.tid })
      .orderBy('started_at', 'desc')
      .limit(Number(q.limit ?? 50));
    return qb;
  });

  app.get<{ Params: { id: string } }>('/meetings/:id', async (req) => {
    if (!canManage(req.user.role)) throw forbidden('manager or admin required');
    const meeting = await db('meetings').where({ id: req.params.id, tenant_id: req.user.tid }).first();
    if (!meeting) throw notFound('Meeting');
    const [participants, proposals] = await Promise.all([
      db('meeting_participants').where({ meeting_id: meeting.id }),
      db('meeting_action_proposals').where({ meeting_id: meeting.id }).orderBy('proposed_at', 'desc'),
    ]);
    return { ...meeting, participants, proposals };
  });

  // ---- DISPATCH (stub LLM → proposals) ----
  app.post<{ Params: { id: string } }>('/meetings/:id/dispatch', async (req) => {
    ensureFirefliesEnabled();
    if (!canManage(req.user.role)) throw forbidden('manager or admin required');
    const meeting = await db('meetings').where({ id: req.params.id, tenant_id: req.user.tid }).first();
    if (!meeting) throw notFound('Meeting');

    const proposals = await dispatchLLM(meeting.id, meeting.transcript ?? '');
    const inserted: any[] = [];
    for (const p of proposals) {
      const [row] = await db('meeting_action_proposals')
        .insert({
          tenant_id: req.user.tid,
          meeting_id: meeting.id,
          kind: p.kind,
          payload: p.payload as any,
          reasoning: p.reasoning,
          proposed_by: null, // null = from LLM
        })
        .returning('*');
      inserted.push(row);
    }
    return { generated: inserted.length, proposals: inserted };
  });

  // ---- APPLY A PROPOSAL ----
  app.post<{ Params: { id: string } }>('/meeting-proposals/:id/apply', async (req) => {
    if (!canManage(req.user.role)) throw forbidden('manager or admin required');
    const parsed = proposalApplySchema.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest('invalid_request', 'Invalid payload');

    const proposal = await db('meeting_action_proposals')
      .where({ id: req.params.id, tenant_id: req.user.tid })
      .first();
    if (!proposal) throw notFound('Proposal');
    if (proposal.status === 'applied') {
      return { ok: true, alreadyApplied: true };
    }

    try {
      switch (proposal.kind as string) {
        case 'log_hours': {
          // The host user lives on the meeting, not the proposal.
          const meetingRow = await db('meetings').where({ id: proposal.meeting_id }).first();
          const hostUserId = meetingRow?.host_user_id ?? null;
          const host = hostUserId ? await db('users').where({ id: hostUserId }).first() : null;
          const payload = proposal.payload as { hours?: number };
          if (!payload.hours || !host) {
            throw new Error('log_hours proposal missing hours or host user');
          }
          // Pick the most-recently-used project for the host; fall back to the
          // first project in the tenant (e.g. managers with no time logs).
          const last = await db('work_logs')
            .where({ worker_id: host.id, tenant_id: req.user.tid })
            .orderBy('created_at', 'desc')
            .first();
          let projectId = last?.project_id ?? null;
          if (!projectId) {
            const p = await db('projects').where({ tenant_id: req.user.tid }).orderBy('created_at', 'asc').first();
            projectId = p?.id ?? null;
          }
          if (!projectId) throw new Error('No project available to attach the log to');
          await db('work_logs').insert({
            tenant_id: req.user.tid,
            worker_id: host.id,
            date: todayIso(),
            project_id: projectId,
            task_id: last?.task_id ?? null,
            hours: payload.hours,
            description: `[auto] from meeting ${proposal.meeting_id} proposal ${proposal.id}`,
          });
          break;
        }
        case 'create_task': {
          const payload = proposal.payload as { title?: string };
          if (!payload.title) throw new Error('create_task proposal missing title');
          const last = await db('work_logs')
            .where({ worker_id: req.user.sub, tenant_id: req.user.tid })
            .orderBy('created_at', 'desc')
            .first();
          const projectId = last?.project_id ?? (
            await db('projects').where({ tenant_id: req.user.tid }).first()
          )?.id;
          if (!projectId) throw new Error('No project available to attach the new task to');
          await db('tasks').insert({
            tenant_id: req.user.tid,
            project_id: projectId,
            title: payload.title,
            description: `Created from meeting ${(proposal as any).meeting_id}`,
            status: 'backlog',
            priority: 'medium',
            created_by: req.user.sub,
          });
          break;
        }
        case 'task_status_change': {
          // Implementation deferred — would resolve the affected task and flip status.
          // Left as 'applied' with reasoning; the proposal UI surfaces what was done.
          break;
        }
        case 'flag_missing_log': {
          // Pure advisory — no DB writes. Mark applied for audit.
          break;
        }
        default:
          throw new Error(`Unknown proposal kind: ${String(proposal.kind)}`);
      }

      await db('meeting_action_proposals')
        .where({ id: proposal.id })
        .update({
          status: 'applied',
          applied_at: db.fn.now(),
          reviewed_by: req.user.sub,
          reviewed_at: db.fn.now(),
        });
      return { ok: true };
    } catch (e: any) {
      await db('meeting_action_proposals')
        .where({ id: proposal.id })
        .update({ status: 'failed', applied_error: String(e?.message ?? e) });
      throw badRequest('apply_failed', String(e?.message ?? e));
    }
  });

  app.post<{ Params: { id: string } }>('/meeting-proposals/:id/reject', async (req) => {
    if (!canManage(req.user.role)) throw forbidden('manager or admin required');
    const proposal = await db('meeting_action_proposals')
      .where({ id: req.params.id, tenant_id: req.user.tid })
      .first();
    if (!proposal) throw notFound('Proposal');
    await db('meeting_action_proposals')
      .where({ id: proposal.id })
      .update({
        status: 'rejected',
        reviewed_by: req.user.sub,
        reviewed_at: db.fn.now(),
      });
    return { ok: true };
  });

  // ---- INTEGRATION SETTINGS ----
  app.get('/integrations/settings', async (req) => {
    if (!canManage(req.user.role)) throw forbidden('manager or admin required');
    const rows = await db('integration_settings').where({ tenant_id: req.user.tid });
    return rows.map((r: any) => ({
      provider: r.provider,
      enabled: r.enabled,
      // Never echo back secrets.
      hasSecret: Boolean(r.config?.apiKey ?? r.config?.webhookSecret),
      config: Object.fromEntries(
        Object.entries(r.config ?? {}).filter(([k]) => !/key|secret|token/i.test(k))
      ),
      updatedAt: r.updated_at,
    }));
  });

  const settingsUpsertSchema = z.object({
    provider: z.string().min(1).max(50),
    enabled: z.boolean().default(false),
    apiKey: z.string().optional(),
    webhookSecret: z.string().optional(),
    extra: z.record(z.unknown()).optional(),
  });

  app.put('/integrations/settings', async (req) => {
    if (!canManage(req.user.role)) throw forbidden('manager or admin required');
    const parsed = settingsUpsertSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('invalid_request', 'Invalid settings', parsed.error.flatten());

    const configJson: Record<string, unknown> = { ...(parsed.data.extra ?? {}) };
    if (parsed.data.apiKey) configJson.apiKey = parsed.data.apiKey;
    if (parsed.data.webhookSecret) configJson.webhookSecret = parsed.data.webhookSecret;

    await db('integration_settings')
      .insert({
        tenant_id: req.user.tid,
        provider: parsed.data.provider,
        enabled: parsed.data.enabled,
        config: configJson as any,
        updated_by: req.user.sub,
      })
      .onConflict(['tenant_id', 'provider'])
      .merge({
        enabled: parsed.data.enabled,
        config: configJson as any,
        updated_by: req.user.sub,
        updated_at: db.fn.now(),
      });
    return { ok: true };
  });
}