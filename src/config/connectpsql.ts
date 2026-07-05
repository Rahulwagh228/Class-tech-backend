import pg from 'pg';
import { env } from './env.js';

const { Pool } = pg;

// =============================================================================
// LOCAL POSTGRES (commented out - kept for future reference)
// -----------------------------------------------------------------------------
// Uses DATABASE_URL pointing at a local pgAdmin / localhost Postgres instance.
// Useful when developing offline. To switch back:
//   1. Uncomment this block.
//   2. Comment out the Supabase block below.
//   3. Make sure DATABASE_URL is set in .env.
// =============================================================================
//
// if (!env.DATABASE_URL) {
//   throw new Error(
//     'DATABASE_URL is not set. The pg pool was imported but no connection ' +
//       'string is configured. Either set DATABASE_URL in .env or remove the ' +
//       'import of connectpsql from your code.'
//   );
// }
//
// const databaseUrl: string = env.DATABASE_URL;
//
// const pool = new Pool({
//   connectionString: databaseUrl,
//   max: 10,
//   idleTimeoutMillis: 30_000,
//   connectionTimeoutMillis: 5_000
// });


// =============================================================================
// SUPABASE POSTGRES (active)
// -----------------------------------------------------------------------------
// Connects to the same Supabase database, but via the standard `pg` driver -
// no Supabase JS client. This keeps our SQL portable: switching providers
// later means changing the connection string, nothing else.
//
// Get the URL from:
//   Supabase Dashboard -> Project Settings -> Database -> Connection string -> URI
//
// Prefer the Transaction pooler (host: aws-0-<region>.pooler.supabase.com,
// port 6543). It handles short-lived connections (Vercel, hot reloads) far
// better than the direct 5432 connection.
//
// SSL is required by Supabase. We disable cert verification because Supabase's
// poolers use a non-public CA; the connection itself is still encrypted.
// =============================================================================
const supabaseDbUrl: string = env.SUPABASE_DB_URL ?? env.DATABASE_URL ?? '';

if (!supabaseDbUrl) {
  throw new Error(
    'No Postgres connection string is configured. Set SUPABASE_DB_URL ' +
      '(preferred for Vercel) or DATABASE_URL in the environment.'
  );
}

const pool = new Pool({
  connectionString: supabaseDbUrl,
  ssl: { rejectUnauthorized: false },
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
  .then(() => console.log('[pg] connected to', maskUrl(supabaseDbUrl)))
  .catch((err) => console.error('[pg] failed to connect:', err.message));

function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '<invalid Postgres connection string>';
  }
}

export default pool;
