import type { Knex } from 'knex';

/**
 * Customers — the businesses / external parties we do projects for.
 *
 * Each project may be bound to one customer (nullable — some projects are
 * internal and have no external client). Replaces the ad-hoc
 * `projects.client_name` free-text field with a real first-class entity so
 * the project → client relationship is queryable.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('customers', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.string('name', 200).notNullable();
    t.string('code', 50);
    t.string('contact_name', 200);
    t.string('contact_email', 200);
    t.string('contact_phone', 50);
    t.string('address', 500);
    t.text('notes');
    t.enu('status', ['active', 'archived'], { useNative: true, enumName: 'customer_status' })
      .notNullable()
      .defaultTo('active');
    t.uuid('created_by').references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['tenant_id', 'status']);
    t.index(['tenant_id', 'name']);
  });

  // Bind projects → customers (nullable, so existing rows stay valid).
  await knex.schema.alterTable('projects', (t) => {
    t.uuid('customer_id').references('id').inTable('customers').onDelete('SET NULL');
  });
  await knex.schema.alterTable('projects', (t) => {
    t.index(['customer_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('projects', (t) => {
    t.dropIndex(['customer_id']);
    t.dropColumn('customer_id');
  });
  await knex.schema.dropTableIfExists('customers');
  await knex.raw('DROP TYPE IF EXISTS customer_status');
}