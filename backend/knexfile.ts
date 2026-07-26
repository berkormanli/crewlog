import type { Knex } from 'knex';
import 'dotenv/config';

const connection = process.env.DATABASE_URL;
if (!connection) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env.');
}

// In production we ship a compiled knexfile.js (TS→JS) and the migrations/
// seeds alongside it under dist/. The compiled artifacts have a .js extension,
// while in dev (`tsx watch`) we load them as .ts directly from source.
const extension = process.env.NODE_ENV === 'production' ? 'js' : 'ts';

const base: Knex.Config = {
  client: 'pg',
  connection,
  pool: { min: 0, max: 10 },
  migrations: {
    directory: './migrations',
    extension,
    tableName: 'knex_migrations',
  },
  seeds: {
    directory: './seeds',
    extension,
  },
};

const config: { [k: string]: Knex.Config } = {
  development: base,
  production: base,
  test: base,
};

export default config;
