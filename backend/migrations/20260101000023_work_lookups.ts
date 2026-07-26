import type { Knex } from 'knex';

/**
 * Per-tenant lookup tables for the activity-log dropdowns.
 *
 * Each tenant manages its own list of `work_modules` (e.g. "Foundation",
 * "Electrical", "Finishes") and `work_locations` (e.g. "Main Site",
 * "Office", "Yard"). The "Other" label is reserved by the application —
 * a tenant can never create a row called "Other" because the UI uses it
 * as a sentinel that opens a free-text input.
 *
 * Seeded with a handful of sensible defaults so the dropdown is useful
 * immediately after a fresh install.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('work_modules', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.string('name', 100).notNullable();
    t.boolean('is_default').notNullable().defaultTo(false);
    t.uuid('created_by').references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['tenant_id', 'name']);
  });

  await knex.schema.createTable('work_locations', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.string('name', 100).notNullable();
    t.boolean('is_default').notNullable().defaultTo(false);
    t.uuid('created_by').references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['tenant_id', 'name']);
  });

  // Seed default modules + locations for every tenant. The application
  // never deletes a row flagged `is_default` so subsequent seeds stay
  // idempotent — new tenants get a full set, existing ones get the
  // missing ones filled in.
  const tenants = await knex('tenants').select('id');
  const tenantIds = tenants.map((t) => t.id);

  const defaultModules = [
    'Foundation',
    'Structure',
    'Framing',
    'Electrical',
    'Plumbing',
    'HVAC',
    'Finishes',
    'Site Safety',
    'Documentation',
    'Meeting',
    'Travel',
  ];
  const defaultLocations = [
    'Main Site',
    'Office',
    'Yard',
    'Remote',
    'Customer Site',
  ];

  for (const tid of tenantIds) {
    for (const name of defaultModules) {
      await knex.raw(
        `INSERT INTO work_modules (tenant_id, name, is_default)
         VALUES (?, ?, true)
         ON CONFLICT (tenant_id, name) DO NOTHING`,
        [tid, name]
      );
    }
    for (const name of defaultLocations) {
      await knex.raw(
        `INSERT INTO work_locations (tenant_id, name, is_default)
         VALUES (?, ?, true)
         ON CONFLICT (tenant_id, name) DO NOTHING`,
        [tid, name]
      );
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('work_locations');
  await knex.schema.dropTableIfExists('work_modules');
}
