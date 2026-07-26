import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('tasks', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.uuid('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
    t.string('title', 300).notNullable();
    t.text('description');
    t.uuid('assignee_id').references('id').inTable('users').onDelete('SET NULL');
    t.uuid('created_by').references('id').inTable('users').onDelete('SET NULL');
    t.enu('status', ['todo', 'in_progress', 'blocked', 'done'], {
      useNative: true,
      enumName: 'task_status',
    })
      .notNullable()
      .defaultTo('todo');
    t.enu('priority', ['low', 'medium', 'high', 'urgent'], {
      useNative: true,
      enumName: 'task_priority',
    })
      .notNullable()
      .defaultTo('medium');
    t.date('due_date');
    t.decimal('estimated_hours', 6, 2);
    t.decimal('actual_hours', 8, 2).notNullable().defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['tenant_id', 'assignee_id', 'status']);
    t.index(['project_id']);
    t.index(['tenant_id', 'due_date']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('tasks');
  await knex.raw('DROP TYPE IF EXISTS task_status');
  await knex.raw('DROP TYPE IF EXISTS task_priority');
}
