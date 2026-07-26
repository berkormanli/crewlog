import type { Knex } from 'knex';

/**
 * Fireflies.ai / LLM integration seams. This migration does NOT enable the
 * real fireflies integration — it only creates the storage shape so that:
 *
 *   1. The webhook ingest endpoint has somewhere to write.
 *   2. The LLM dispatcher can produce auditable action proposals.
 *   3. A future UI has the data to render against.
 *
 * Until FIREFLIES_ENABLED is set in the env, all routes return 503.
 */

export async function up(knex: Knex): Promise<void> {
  // Tenant-scoped integration configuration. Stores (e.g.) the fireflies API
  // key, the chosen LLM provider, prompt templates, etc. For the demo we keep
  // the secret as JSON; in production swap to a proper secrets manager.
  await knex.schema.createTable('integration_settings', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.string('provider', 50).notNullable(); // 'fireflies' | 'openai' | 'anthropic' | ...
    t.boolean('enabled').notNullable().defaultTo(false);
    t.jsonb('config').notNullable().defaultTo(knex.raw("'{}'::jsonb"));
    t.uuid('updated_by').references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['tenant_id', 'provider']);
  });

  // A meeting ingested from fireflies (or any provider).
  await knex.schema.createTable('meetings', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.string('external_id', 200); // provider-side id, for dedupe
    t.string('provider', 50).notNullable().defaultTo('fireflies');
    t.string('title', 500);
    t.text('transcript');
    t.string('source_url', 1000);
    t.timestamp('started_at', { useTz: true });
    t.timestamp('ended_at', { useTz: true });
    t.uuid('host_user_id').references('id').inTable('users').onDelete('SET NULL');
    t.jsonb('raw_payload').notNullable().defaultTo(knex.raw("'{}'::jsonb"));
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['provider', 'external_id']);
    t.index(['tenant_id', 'started_at']);
  });

  // Participants in a meeting — needed to map transcript speakers → users.
  await knex.schema.createTable('meeting_participants', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('meeting_id').notNullable().references('id').inTable('meetings').onDelete('CASCADE');
    t.uuid('user_id').references('id').inTable('users').onDelete('SET NULL');
    t.string('display_name', 200); // when user_id is unknown
    t.string('email', 200);
    t.index(['meeting_id']);
  });

  // Proposals emitted by the LLM. Each row is an auditable intent.
  await knex.schema.createTable('meeting_action_proposals', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.uuid('meeting_id').references('id').inTable('meetings').onDelete('CASCADE');
    t.enu('kind', ['task_status_change', 'create_task', 'log_hours', 'flag_missing_log'], {
      useNative: true,
      enumName: 'meeting_proposal_kind',
    }).notNullable();
    t.jsonb('payload').notNullable().defaultTo(knex.raw("'{}'::jsonb"));
    t.enu('status', ['pending', 'approved', 'rejected', 'applied', 'failed'], {
      useNative: true,
      enumName: 'meeting_proposal_status',
    }).notNullable().defaultTo('pending');
    t.text('reasoning');
    t.uuid('proposed_by'); // null = LLM, otherwise a human reviewer
    t.uuid('reviewed_by').references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('proposed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('reviewed_at', { useTz: true });
    t.timestamp('applied_at', { useTz: true });
    t.text('applied_error');
    t.index(['tenant_id', 'status']);
    t.index(['meeting_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('meeting_action_proposals');
  await knex.raw('DROP TYPE IF EXISTS meeting_proposal_status');
  await knex.raw('DROP TYPE IF EXISTS meeting_proposal_kind');
  await knex.schema.dropTableIfExists('meeting_participants');
  await knex.schema.dropTableIfExists('meetings');
  await knex.schema.dropTableIfExists('integration_settings');
}