import type { Knex } from 'knex';

/**
 * Ad-hoc work log support.
 *
 * - `project_id` becomes nullable (a worker can log time without a project).
 * - `customer_id` is added (a worker can log time against a customer
 *   directly, without being bound to a project).
 * - `task_id` is already nullable — kept as-is.
 * - Adds `module` + `module_other` (the "describe what you were working on"
 *   picker). `module` is a free-text label from the tenant's
 *   `work_modules` lookup; if the worker picks "Other" they get a
 *   free-text `module_other` field on the same row.
 * - Adds `location` + `location_other` (the "where were you" picker), same
 *   pattern as module.
 * - Adds `start_time` + `end_time` (TIME) so the worker can punch in
 *   a time window instead of typing the hours. The `hours` column is
 *   kept (the UI shows it everywhere) and is now derived from the
 *   time-of-day window when present, or set directly when absent.
 * - Adds `timezone` to `users` so each worker has a per-user TZ (IANA
 *   identifier like "Europe/Istanbul"). The default falls back to the
 *   server's local timezone, but the user can override it in
 *   `/settings` and we capture it on first login too.
 *
 * The existing `work_logs_hours_check` constraint is loosened so that
 * rows can be created via the time-window path (the application enforces
 * the > 0 / <= 24 / 0.25 step invariants before insert).
 */
export async function up(knex: Knex): Promise<void> {
  // --- work_logs changes ---
  await knex.schema.alterTable('work_logs', (t) => {
    t.uuid('customer_id').references('id').inTable('customers').onDelete('SET NULL');
    t.string('module', 100);
    t.string('module_other', 200);
    t.string('location', 100);
    t.string('location_other', 200);
    t.time('start_time');
    t.time('end_time');
  });

  // Drop NOT NULL on project_id so ad-hoc logs without a project are valid.
  await knex.raw('ALTER TABLE work_logs ALTER COLUMN project_id DROP NOT NULL');

  // The old constraint required hours > 0 + 0.25-step. Now we accept either
  // hours OR a time window (the app computes hours from the window and
  // stores both). Drop the DB-level constraint and rely on the application.
  await knex.raw('ALTER TABLE work_logs DROP CONSTRAINT IF EXISTS work_logs_hours_check');
  // Make hours nullable so we can have rows that came from a time window
  // the app didn't get to populate (e.g. a legacy row).
  await knex.raw('ALTER TABLE work_logs ALTER COLUMN hours DROP NOT NULL');

  // Sanity: if start_time is set, end_time must be set too, and end > start.
  await knex.raw(`
    ALTER TABLE work_logs
    ADD CONSTRAINT work_logs_time_window_check
    CHECK (
      (start_time IS NULL AND end_time IS NULL)
      OR (start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time)
    )
  `);

  // Sanity: at least one of project_id or customer_id OR a customer-bound
  // project. We don't require either — ad-hoc logs with neither are valid
  // ("I worked on-site but wasn't tied to a project or customer this morning").
  // So this comment is intentionally a no-op.

  // Helpful indexes for the new lookups.
  await knex.raw('CREATE INDEX IF NOT EXISTS work_logs_tenant_module_idx ON work_logs (tenant_id, module)');
  await knex.raw('CREATE INDEX IF NOT EXISTS work_logs_tenant_location_idx ON work_logs (tenant_id, location)');
  await knex.raw('CREATE INDEX IF NOT EXISTS work_logs_tenant_customer_date_idx ON work_logs (tenant_id, customer_id, date)');

  // --- users.timezone ---
  await knex.schema.alterTable('users', (t) => {
    t.string('timezone', 100).defaultTo('UTC');
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
  });
  // Backfill any pre-existing rows so the column is non-null.
  await knex.raw(`UPDATE users SET timezone = 'UTC' WHERE timezone IS NULL`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS work_logs_tenant_module_idx');
  await knex.raw('DROP INDEX IF EXISTS work_logs_tenant_location_idx');
  await knex.raw('DROP INDEX IF EXISTS work_logs_tenant_customer_date_idx');
  await knex.raw('ALTER TABLE work_logs DROP CONSTRAINT IF EXISTS work_logs_time_window_check');
  await knex.schema.alterTable('work_logs', (t) => {
    t.dropColumn('customer_id');
    t.dropColumn('module');
    t.dropColumn('module_other');
    t.dropColumn('location');
    t.dropColumn('location_other');
    t.dropColumn('start_time');
    t.dropColumn('end_time');
  });
  // Restore the original constraint.
  await knex.raw(`
    ALTER TABLE work_logs
    ALTER COLUMN project_id SET NOT NULL,
    ALTER COLUMN hours SET NOT NULL,
    ADD CONSTRAINT work_logs_hours_check
    CHECK (hours > 0 AND hours <= 24 AND (hours * 4)::numeric = FLOOR(hours * 4)::numeric)
  `);
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('updated_at');
    t.dropColumn('timezone');
  });
}
