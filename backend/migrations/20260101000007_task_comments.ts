import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('task_comments', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('task_id').notNullable().references('id').inTable('tasks').onDelete('CASCADE');
    t.uuid('author_id').references('id').inTable('users').onDelete('SET NULL');
    t.text('body').notNullable();
    t.uuid('parent_id').references('id').inTable('task_comments').onDelete('CASCADE');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['task_id', 'created_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('task_comments');
}
