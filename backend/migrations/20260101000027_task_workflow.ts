import type { Knex } from 'knex';

const STATUS_TYPE = 'task_status';

/**
 * Expand the fixed task lifecycle to the workflow agreed for the first Efor
 * rollout. Existing `blocked` tasks become `waiting` tasks.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TABLE tasks ALTER COLUMN status DROP DEFAULT`);
  await knex.raw(`ALTER TYPE ${STATUS_TYPE} RENAME TO ${STATUS_TYPE}_legacy`);
  await knex.raw(`
    CREATE TYPE ${STATUS_TYPE} AS ENUM (
      'backlog',
      'todo',
      'in_progress',
      'waiting',
      'review',
      'done'
    )
  `);
  await knex.raw(`
    ALTER TABLE tasks
    ALTER COLUMN status TYPE ${STATUS_TYPE}
    USING (
      CASE
        WHEN status::text = 'blocked' THEN 'waiting'
        ELSE status::text
      END
    )::${STATUS_TYPE}
  `);
  await knex.raw(`ALTER TABLE tasks ALTER COLUMN status SET DEFAULT 'backlog'::${STATUS_TYPE}`);
  await knex.raw(`DROP TYPE ${STATUS_TYPE}_legacy`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TABLE tasks ALTER COLUMN status DROP DEFAULT`);
  await knex.raw(`ALTER TYPE ${STATUS_TYPE} RENAME TO ${STATUS_TYPE}_efor`);
  await knex.raw(`
    CREATE TYPE ${STATUS_TYPE} AS ENUM ('todo', 'in_progress', 'blocked', 'done')
  `);
  await knex.raw(`
    ALTER TABLE tasks
    ALTER COLUMN status TYPE ${STATUS_TYPE}
    USING (
      CASE
        WHEN status::text = 'waiting' THEN 'blocked'
        WHEN status::text = 'review' THEN 'in_progress'
        WHEN status::text = 'backlog' THEN 'todo'
        ELSE status::text
      END
    )::${STATUS_TYPE}
  `);
  await knex.raw(`ALTER TABLE tasks ALTER COLUMN status SET DEFAULT 'todo'::${STATUS_TYPE}`);
  await knex.raw(`DROP TYPE ${STATUS_TYPE}_efor`);
}
