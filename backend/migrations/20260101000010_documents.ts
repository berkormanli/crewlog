import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('documents', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.uuid('project_id').references('id').inTable('projects').onDelete('SET NULL');
    t.uuid('folder_id').references('id').inTable('folders').onDelete('SET NULL');
    t.string('name', 300).notNullable();
    t.text('description');
    t.uuid('uploaded_by').references('id').inTable('users').onDelete('SET NULL');
    t.string('file_path', 500).notNullable();
    t.string('mime_type', 200).notNullable();
    t.bigInteger('size_bytes').notNullable();
    t.integer('version').notNullable().defaultTo(1);
    t.uuid('parent_document_id').references('id').inTable('documents').onDelete('SET NULL');
    t.enu('visibility', ['private', 'team', 'project'], {
      useNative: true,
      enumName: 'doc_visibility',
    })
      .notNullable()
      .defaultTo('team');
    t.boolean('is_archived').notNullable().defaultTo(false);
    t.timestamp('deleted_at', { useTz: true });
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['tenant_id', 'project_id', 'folder_id']);
    t.index(['tenant_id', 'name']);
    t.index(['parent_document_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('documents');
  await knex.raw('DROP TYPE IF EXISTS doc_visibility');
}
