import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('projects', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.string('name', 200).notNullable();
    t.string('code', 50).notNullable();
    t.text('description');
    t.enu('status', ['active', 'paused', 'archived'], { useNative: true, enumName: 'project_status' })
      .notNullable()
      .defaultTo('active');
    t.date('start_date');
    t.date('end_date');
    t.string('color', 9).notNullable().defaultTo('#3b82f6');
    t.string('client_name', 200);
    t.uuid('created_by').references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['tenant_id', 'code']);
    t.index(['tenant_id', 'status']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('projects');
  await knex.raw('DROP TYPE IF EXISTS project_status');
}
