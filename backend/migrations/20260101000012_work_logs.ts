import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('work_logs', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.uuid('worker_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.date('date').notNullable();
    t.uuid('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
    t.uuid('task_id').references('id').inTable('tasks').onDelete('SET NULL');
    t.decimal('hours', 5, 2).notNullable();
    t.text('description').notNullable().defaultTo('');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['tenant_id', 'worker_id', 'date']);
    t.index(['tenant_id', 'project_id', 'date']);
  });

  // Constrain hours to 0.25 increments & 0 < x <= 24 via CHECK.
  await knex.raw(`
    ALTER TABLE work_logs
    ADD CONSTRAINT work_logs_hours_check
    CHECK (hours > 0 AND hours <= 24 AND (hours * 4)::numeric = FLOOR(hours * 4)::numeric)
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('work_logs');
}
