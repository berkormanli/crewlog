import type { Knex } from 'knex';

/**
 * Server-persisted work sessions controlled from a task. A user can have at
 * most one running or paused session at a time; stopped sessions are retained
 * as history and produce a work_log when their rounded duration is usable.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('task_work_sessions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.uuid('task_id').notNullable().references('id').inTable('tasks').onDelete('CASCADE');
    t.uuid('worker_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.enu('status', ['running', 'paused', 'stopped'], {
      useNative: true,
      enumName: 'task_work_session_status',
    }).notNullable().defaultTo('running');
    t.timestamp('started_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('active_started_at', { useTz: true });
    t.timestamp('paused_at', { useTz: true });
    t.timestamp('ended_at', { useTz: true });
    t.integer('accumulated_seconds').notNullable().defaultTo(0);
    t.integer('duration_seconds');
    t.uuid('work_log_id').references('id').inTable('work_logs').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['tenant_id', 'task_id', 'created_at']);
    t.index(['tenant_id', 'worker_id', 'status']);
  });

  await knex.raw(`
    CREATE UNIQUE INDEX task_work_sessions_one_active_per_worker
    ON task_work_sessions (tenant_id, worker_id)
    WHERE status IN ('running', 'paused')
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS task_work_sessions_one_active_per_worker');
  await knex.schema.dropTableIfExists('task_work_sessions');
  await knex.raw('DROP TYPE IF EXISTS task_work_session_status');
}
