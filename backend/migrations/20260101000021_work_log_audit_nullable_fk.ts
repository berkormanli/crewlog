import type { Knex } from 'knex';

/**
 * Loosens `work_log_audit.work_log_id` so audit history survives the
 * deletion of the parent `work_log` row.
 *
 * Why: the previous schema had `work_log_id NOT NULL` with `ON DELETE CASCADE`,
 * which meant deleting a work_log also deleted every audit row tied to it.
 * Combined with the work-logs DELETE handler running the actual row delete
 * BEFORE writing the audit insert, this triggered a foreign-key violation
 * ("work_log_id is not present in table work_logs").
 *
 * Fix:
 *   1. Make `work_log_id` nullable.
 *   2. Replace the FK's ON DELETE action with `SET NULL` so the audit row
 *      survives the parent deletion but its pointer is reset to NULL.
 *
 * The richer per-work_log history (before/after payloads) is preserved
 * because jsonb is unrelated to this FK.
 */
export async function up(knex: Knex): Promise<void> {
  // Postgres names auto-generated FKs as `<table>_<col>_foreign`.
  await knex.raw('ALTER TABLE work_log_audit DROP CONSTRAINT IF EXISTS work_log_audit_work_log_id_foreign');

  await knex.raw('ALTER TABLE work_log_audit ALTER COLUMN work_log_id DROP NOT NULL');

  await knex.raw(`
    ALTER TABLE work_log_audit
    ADD CONSTRAINT work_log_audit_work_log_id_foreign
    FOREIGN KEY (work_log_id) REFERENCES work_logs (id) ON DELETE SET NULL
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Down-migration can fail if any orphaned (work_log_id IS NULL) rows
  // exist — but those rows only ever appear because of this migration,
  // so a clean rollback is fine.
  await knex.raw('ALTER TABLE work_log_audit DROP CONSTRAINT IF EXISTS work_log_audit_work_log_id_foreign');
  await knex.raw(
    'DELETE FROM work_log_audit WHERE work_log_id IS NULL'
  );
  await knex.raw('ALTER TABLE work_log_audit ALTER COLUMN work_log_id SET NOT NULL');
  await knex.raw(`
    ALTER TABLE work_log_audit
    ADD CONSTRAINT work_log_audit_work_log_id_foreign
    FOREIGN KEY (work_log_id) REFERENCES work_logs (id) ON DELETE CASCADE
  `);
}
