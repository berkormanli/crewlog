import type { Knex } from 'knex';

/**
 * Drop the per-task `estimated_hours` column.
 *
 * The crew no longer wants per-task estimates; only actual hours worked are
 * tracked. The "expected hours" concept (per-day, per-worker) used by the
 * timesheet is a separate feature backed by `users.default_daily_hours` and
 * `daily_capacity.expected_hours`, both of which are kept untouched.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('tasks', (t) => {
    t.dropColumn('estimated_hours');
  });
  await knex.schema.alterTable('task_requests', (t) => {
    t.dropColumn('estimated_hours');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('tasks', (t) => {
    t.decimal('estimated_hours', 6, 2);
  });
  await knex.schema.alterTable('task_requests', (t) => {
    t.decimal('estimated_hours', 6, 2);
  });
}