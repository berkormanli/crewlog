import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('users', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.string('email', 200).notNullable();
    t.string('password_hash', 255).notNullable();
    t.string('full_name', 200).notNullable();
    t.enu('role', ['worker', 'manager', 'admin'], { useNative: true, enumName: 'user_role' })
      .notNullable()
      .defaultTo('worker');
    t.string('avatar_url', 500);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('last_login_at', { useTz: true });
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['tenant_id', 'email']);
    t.index(['tenant_id', 'role']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('users');
  await knex.raw('DROP TYPE IF EXISTS user_role');
}
