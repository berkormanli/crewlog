import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('work_log_audit', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('work_log_id').notNullable().references('id').inTable('work_logs').onDelete('CASCADE');
    t.uuid('actor_id').references('id').inTable('users').onDelete('SET NULL');
    t.string('action', 60).notNullable();
    t.jsonb('before').notNullable().defaultTo('null');
    t.jsonb('after').notNullable().defaultTo('null');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['work_log_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('work_log_audit');
}
