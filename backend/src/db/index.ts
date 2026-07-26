import knex, { Knex } from 'knex';
import { config } from '../config.js';

export const db: Knex = knex({
  client: 'pg',
  connection: config.databaseUrl,
  pool: { min: 0, max: 10 },
});

export type DB = typeof db;
