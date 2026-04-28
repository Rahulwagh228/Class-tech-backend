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

// Smoke-test the connection at startup so failures show up immediately
// instead of on the first request.
pool
  .query('SELECT 1')
  .then(() => console.log('[pg] connected to', maskUrl(env.DATABASE_URL)))
  .catch((err) => console.error('[pg] failed to connect:', err.message));

function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '<invalid DATABASE_URL>';
  }
}

export default pool;
