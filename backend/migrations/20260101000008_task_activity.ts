import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('task_activity', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('task_id').notNullable().references('id').inTable('tasks').onDelete('CASCADE');
    t.uuid('actor_id').references('id').inTable('users').onDelete('SET NULL');
    t.string('action', 80).notNullable();
    t.jsonb('payload').notNullable().defaultTo('{}');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['task_id', 'created_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('task_activity');
}
