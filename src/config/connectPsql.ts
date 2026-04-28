import pg from 'pg';
import { env } from './env.js';

const { Pool } = pg;

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000
});

pool.on('error', (err) => {
  console.error('Unexpected idle Postgres client error', err);
});

export default pool;
