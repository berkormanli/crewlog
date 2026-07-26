import type { Knex } from 'knex';

/**
 * Adds indexes that the activity-feed queries lean on heavily, and
 * backfills any pre-existing `work_log_audit` rows into the unified
 * `audit_log` table so the admin activity feed isn't empty right after
 * upgrading.
 *
 * The `work_log_audit` table is treated as the historical source of truth
 * for work_log changes made before the unified `audit_log` was in place.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS audit_log_tenant_actor_created_idx ON audit_log (tenant_id, actor_id, created_at DESC)'
  );
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS audit_log_tenant_action_created_idx ON audit_log (tenant_id, action, created_at DESC)'
  );

  // Backfill: any tenant that has work_log_audit rows but no rows in
  // audit_log for those same work logs gets a fresh insert. We use DISTINCT
  // so we don't create duplicates if the upgrade is run twice.
  await knex.raw(`
    INSERT INTO audit_log (tenant_id, actor_id, action, entity_type, entity_id, payload, created_at)
    SELECT
      w.tenant_id,
      wla.actor_id,
      'work_log.' || wla.action AS action,
      'work_log'::text        AS entity_type,
      wla.work_log_id         AS entity_id,
      jsonb_build_object(
        'before', wla.before,
        'after',  wla.after,
        'backfilled', true
      )                        AS payload,
      wla.created_at          AS created_at
    FROM work_log_audit wla
    JOIN work_logs w ON w.id = wla.work_log_id
    WHERE NOT EXISTS (
      SELECT 1 FROM audit_log a
      WHERE a.tenant_id = w.tenant_id
        AND a.entity_type = 'work_log'
        AND a.entity_id = wla.work_log_id
        AND a.action = 'work_log.' || wla.action
        AND a.created_at = wla.created_at
    )
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS audit_log_tenant_actor_created_idx');
  await knex.raw('DROP INDEX IF EXISTS audit_log_tenant_action_created_idx');
  // No data-loss on rollback — backfilled rows stay in audit_log for transparency.
}
