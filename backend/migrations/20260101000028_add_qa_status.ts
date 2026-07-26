import type { Knex } from 'knex';

const STATUS_TYPE = 'task_status';

/** Add the QA gate between Review and Done. */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TABLE tasks ALTER COLUMN status DROP DEFAULT`);
  await knex.raw(`ALTER TYPE ${STATUS_TYPE} RENAME TO ${STATUS_TYPE}_pre_qa`);
  await knex.raw(`
    CREATE TYPE ${STATUS_TYPE} AS ENUM (
      'backlog',
      'todo',
      'in_progress',
      'waiting',
      'review',
      'qa',
      'done'
    )
  `);
  await knex.raw(`
    ALTER TABLE tasks
    ALTER COLUMN status TYPE ${STATUS_TYPE}
    USING status::text::${STATUS_TYPE}
  `);
  await knex.raw(`ALTER TABLE tasks ALTER COLUMN status SET DEFAULT 'backlog'::${STATUS_TYPE}`);
  await knex.raw(`DROP TYPE ${STATUS_TYPE}_pre_qa`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TABLE tasks ALTER COLUMN status DROP DEFAULT`);
  await knex.raw(`ALTER TYPE ${STATUS_TYPE} RENAME TO ${STATUS_TYPE}_with_qa`);
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
      CASE WHEN status::text = 'qa' THEN 'review' ELSE status::text END
    )::${STATUS_TYPE}
  `);
  await knex.raw(`ALTER TABLE tasks ALTER COLUMN status SET DEFAULT 'backlog'::${STATUS_TYPE}`);
  await knex.raw(`DROP TYPE ${STATUS_TYPE}_with_qa`);
}
