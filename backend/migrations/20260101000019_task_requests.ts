import type { Knex } from 'knex';

/**
 * Task requests — workers submit a request describing work they want done,
 * a manager reviews it, and approval materializes a real `tasks` row.
 *
 * Workers see their own requests; managers see all.
 *
 * Status flow:
 *   pending → approved (creates a task; created_task_id set)
 *   pending → rejected (review_note set)
 *   pending → cancelled (worker withdraws before review)
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('task_requests', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.uuid('requested_by').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.uuid('project_id').references('id').inTable('projects').onDelete('SET NULL');
    t.string('title', 300).notNullable();
    t.text('description');
    t.enu('priority', ['low', 'medium', 'high', 'urgent'], {
      useNative: true,
      enumName: 'task_request_priority',
    })
      .notNullable()
      .defaultTo('medium');
    t.date('due_date');
    t.decimal('estimated_hours', 6, 2);
    t.enu('status', ['pending', 'approved', 'rejected', 'cancelled'], {
      useNative: true,
      enumName: 'task_request_status',
    })
      .notNullable()
      .defaultTo('pending');
    t.uuid('reviewed_by').references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('reviewed_at', { useTz: true });
    t.text('review_note');
    t.uuid('created_task_id').references('id').inTable('tasks').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['tenant_id', 'status']);
    t.index(['tenant_id', 'requested_by']);
    t.index(['project_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('task_requests');
  await knex.raw('DROP TYPE IF EXISTS task_request_status');
  await knex.raw('DROP TYPE IF EXISTS task_request_priority');
}