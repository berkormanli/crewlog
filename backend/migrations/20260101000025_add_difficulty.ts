import type { Knex } from 'knex';

/**
 * Add a `difficulty` enum column to both `tasks` and `task_requests`.
 *
 * Values are distinct from `priority` so the two axes don't get conflated in
 * the UI:
 *   - priority   = when / how urgently it needs attention (low/medium/high/urgent)
 *   - difficulty = how complex or skilled the work is         (easy/medium/hard/expert)
 *
 * Default is `medium` so existing rows get a sensible value automatically.
 * Separate Postgres enum types are created for tasks and task_requests
 * to mirror the existing `task_priority` / `task_request_priority` split.
 */
const DIFFICULTY_VALUES = ['easy', 'medium', 'hard', 'expert'] as const;

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('tasks', (t) => {
    t.enu('difficulty', DIFFICULTY_VALUES, {
      useNative: true,
      enumName: 'task_difficulty',
    })
      .notNullable()
      .defaultTo('medium');
  });

  await knex.schema.alterTable('task_requests', (t) => {
    t.enu('difficulty', DIFFICULTY_VALUES, {
      useNative: true,
      enumName: 'task_request_difficulty',
    })
      .notNullable()
      .defaultTo('medium');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('tasks', (t) => {
    t.dropColumn('difficulty');
  });
  await knex.schema.alterTable('task_requests', (t) => {
    t.dropColumn('difficulty');
  });
  await knex.raw('DROP TYPE IF EXISTS task_difficulty');
  await knex.raw('DROP TYPE IF EXISTS task_request_difficulty');
}