import pg from 'pg';
import { env } from './env.js';

const { Pool } = pg;

if (!env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. The pg pool was imported but no connection string ' +
      'is configured. Either set DATABASE_URL in .env or remove the import of ' +
      'connectpsql from your code (Supabase is the default).'
  );
}

const databaseUrl: string = env.DATABASE_URL;

const pool = new Pool({
  connectionString: databaseUrl,
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
  .then(() => console.log('[pg] connected to', maskUrl(databaseUrl)))
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
