import type { Knex } from 'knex';

/**
 * Per-day override of a worker's expected hours. When a row exists for
 * (worker_id, date), it takes precedence over the user's default_daily_hours.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('daily_capacity', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.uuid('worker_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.date('date').notNullable();
    t.decimal('expected_hours', 4, 2).notNullable();
    t.uuid('set_by').references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['worker_id', 'date']);
    t.index(['tenant_id', 'worker_id', 'date']);
  });
  await knex.raw(`
    ALTER TABLE daily_capacity
    ADD CONSTRAINT daily_capacity_expected_hours_check
    CHECK (expected_hours > 0 AND expected_hours <= 24)
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('daily_capacity');
}