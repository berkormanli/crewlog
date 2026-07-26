import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('project_members', (t) => {
    t.uuid('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.enu('role_in_project', ['lead', 'contributor', 'observer'], {
      useNative: true,
      enumName: 'project_role',
    })
      .notNullable()
      .defaultTo('contributor');
    t.timestamp('added_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.primary(['project_id', 'user_id']);
    t.index(['user_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('project_members');
  await knex.raw('DROP TYPE IF EXISTS project_role');
}
