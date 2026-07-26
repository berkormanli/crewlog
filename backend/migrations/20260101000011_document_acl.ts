import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('document_acl', (t) => {
    t.uuid('document_id').notNullable().references('id').inTable('documents').onDelete('CASCADE');
    t.enu('principal_type', ['user', 'role'], { useNative: true, enumName: 'acl_principal' })
      .notNullable();
    t.uuid('principal_id').notNullable();
    t.enu('permission', ['read', 'write'], { useNative: true, enumName: 'acl_permission' })
      .notNullable();
    t.primary(['document_id', 'principal_type', 'principal_id', 'permission']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('document_acl');
  await knex.raw('DROP TYPE IF EXISTS acl_principal');
  await knex.raw('DROP TYPE IF EXISTS acl_permission');
}
