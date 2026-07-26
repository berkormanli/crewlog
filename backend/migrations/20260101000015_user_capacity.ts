import type { Knex } from 'knex';

/**
 * Add a per-user default daily hours capacity (used by the Timesheet grid to
 * show expected vs. logged hours per day).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (t) => {
    t.decimal('default_daily_hours', 4, 2).notNullable().defaultTo(8);
  });
  // CHECK 0 < x <= 24 (matches work_logs constraint shape)
  await knex.raw(`
    ALTER TABLE users
    ADD CONSTRAINT users_default_daily_hours_check
    CHECK (default_daily_hours > 0 AND default_daily_hours <= 24)
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_default_daily_hours_check`);
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('default_daily_hours');
  });
}