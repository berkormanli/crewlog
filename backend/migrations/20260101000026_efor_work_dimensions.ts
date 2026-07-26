import type { Knex } from 'knex';

/**
 * Align the activity vocabulary with Efor's SAP consulting workflow and add
 * activity type as a separate reporting dimension. A module describes the
 * SAP workstream (MM, SD, EWM, ...); an activity type describes the kind of
 * work (development, support, meeting, ...).
 */
const MODULES = ['MM', 'SD', 'WM', 'EWM', 'PP', 'FI/CO', 'ABAP', 'Basis'];
const ACTIVITY_TYPES = [
  'Development',
  'Support',
  'Analysis',
  'Testing',
  'Meeting',
  'Documentation',
  'Training',
  'Administration',
  'Travel',
];
const LOCATIONS = ['Office', 'Home/Remote', 'Customer Site', 'Travel'];

const LEGACY_MODULES = [
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
const LEGACY_LOCATIONS = ['Main Site', 'Office', 'Yard', 'Remote', 'Customer Site'];

async function replaceDefaults(
  knex: Knex,
  table: 'work_modules' | 'work_locations' | 'work_activity_types',
  tenantId: string,
  names: string[]
) {
  await knex(table).where({ tenant_id: tenantId, is_default: true }).delete();
  for (const name of names) {
    await knex(table)
      .insert({ tenant_id: tenantId, name, is_default: true })
      .onConflict(['tenant_id', 'name'])
      .merge({ is_default: true, updated_at: knex.fn.now() });
  }
}

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('work_activity_types', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.string('name', 100).notNullable();
    t.boolean('is_default').notNullable().defaultTo(false);
    t.uuid('created_by').references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['tenant_id', 'name']);
  });

  await knex.schema.alterTable('work_logs', (t) => {
    t.string('activity_type', 100);
    t.string('activity_type_other', 200);
  });
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS work_logs_tenant_activity_type_idx ON work_logs (tenant_id, activity_type)'
  );

  const tenants = await knex('tenants').select('id');
  for (const tenant of tenants) {
    await replaceDefaults(knex, 'work_modules', tenant.id, MODULES);
    await replaceDefaults(knex, 'work_activity_types', tenant.id, ACTIVITY_TYPES);
    await replaceDefaults(knex, 'work_locations', tenant.id, LOCATIONS);
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS work_logs_tenant_activity_type_idx');
  await knex.schema.alterTable('work_logs', (t) => {
    t.dropColumn('activity_type');
    t.dropColumn('activity_type_other');
  });
  await knex.schema.dropTableIfExists('work_activity_types');

  const tenants = await knex('tenants').select('id');
  for (const tenant of tenants) {
    await replaceDefaults(knex, 'work_modules', tenant.id, LEGACY_MODULES);
    await replaceDefaults(knex, 'work_locations', tenant.id, LEGACY_LOCATIONS);
  }
}
