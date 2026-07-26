/**
 * Unified audit log writer.
 *
 * Every mutation in the app calls `recordAudit(...)` so admin / manager users
 * can see a single chronological feed of "who did what to what, and when" via
 * the `/api/v1/audit-log` endpoint.
 *
 * The legacy `auditLog` helper in `modules/work-logs/routes.ts` was kept for
 * backwards compat but now delegates here.
 *
 * `entity_type` / `entity_id` should make the row useful as a stand-alone
 * record: avoid keys so generic that they lose meaning (e.g. prefer
 * `task`, `task_comment`, `work_log`, `project`, `project_member`, etc.).
 *
 * `payload` is a free-form JSON object describing the change. Convention:
 *   - `before` / `after`: full before / after row snapshots where it's useful
 *     (work_log, project, customer, document, folder). When the row is large
 *     and boring, a short `{ summary }` is enough.
 */
import { db } from '../db/index.js';

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'archive'
  | 'unarchive'
  | 'approve'
  | 'reject'
  | 'cancel'
  | 'assign'
  | 'login'
  | 'logout';

export interface AuditWriteOpts {
  tenantId: string;
  actorId: string;
  action: AuditAction | `${string}.${AuditAction}`;
  entityType: string; // 'work_log' | 'project' | ...
  entityId?: string | null;
  payload?: Record<string, unknown>;
}

/**
 * Convenience: lets callers do `audit.record(req, 'create', 'project', row.id, { ... })`.
 */
export function recordAudit(
  reqLike: { user: { sub: string; tid: string } },
  action: AuditAction | `${string}.${AuditAction}`,
  entityType: string,
  entityId?: string | null,
  payload: Record<string, unknown> = {}
): Promise<void> {
  return recordAuditRaw({
    tenantId: reqLike.user.tid,
    actorId: reqLike.user.sub,
    action,
    entityType,
    entityId,
    payload,
  });
}

export async function recordAuditRaw(opts: AuditWriteOpts): Promise<void> {
  // Best-effort write: never let an audit insert fail a user-facing request.
  try {
    await db('audit_log').insert({
      tenant_id: opts.tenantId,
      actor_id: opts.actorId,
      action: opts.action,
      entity_type: opts.entityType,
      entity_id: opts.entityId ?? null,
      payload: JSON.stringify(opts.payload ?? {}),
    });
  } catch (e) {
    // Surface in logs but never throw — auditing is non-critical.
    // eslint-disable-next-line no-console
    console.error('audit_log write failed:', (e as Error).message);
  }
}

/**
 * Helper to build a small `diff` of changed scalar fields between two rows.
 * Useful for `task.update`, `user.update`, etc. where full before / after is
 * too verbose.
 */
export function diffFields<T extends Record<string, any>>(
  before: T,
  after: T,
  fields: Array<keyof T>
): Record<string, { from: any; to: any }> {
  const out: Record<string, { from: any; to: any }> = {};
  for (const k of fields) {
    const a = (before as any)[k];
    const b = (after as any)[k];
    if (a !== b) out[String(k)] = { from: a, to: b };
  }
  return out;
}
