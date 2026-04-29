import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env.js';

const url = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = env.SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const key = serviceKey ?? anonKey;

// Lazy: don't throw at module load - that would kill the whole serverless
// function before any handler runs. Build a stub that throws only when
// supabase is actually used, so /health and /_diag still work.
let _client: SupabaseClient | null = null;
let _initError: string | null = null;

if (!url || !key) {
  _initError =
    'Supabase config missing. Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and ' +
    'SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_PUBLISHABLE_KEY) in your environment.';
  console.error('[supabase]', _initError);
} else {
  if (!serviceKey) {
    console.warn(
      '[supabase] WARNING: using publishable/anon key on the server. ' +
        'INSERT/UPDATE on protected tables will be blocked by RLS. ' +
        'Set SUPABASE_SERVICE_ROLE_KEY for backend usage.'
    );
  }
  try {
    _client = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    });
    console.log('[supabase] client ready ->', new URL(url).host);
  } catch (err) {
    _initError = `Supabase client init failed: ${(err as Error).message}`;
    console.error('[supabase]', _initError);
  }
}

// Export a Proxy: any property access returns a function that throws a clear
// error if Supabase wasn't configured. Lets the rest of the code stay simple.
const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    if (_client) {
      const value = (_client as unknown as Record<string | symbol, unknown>)[prop];
      return typeof value === 'function' ? (value as Function).bind(_client) : value;
    }
    throw new Error(
      _initError ?? `Supabase client not initialized; cannot access "${String(prop)}"`
    );
  }
});

export default supabase;

// For diagnostics
export const supabaseStatus = () => ({
  configured: !!_client,
  using_service_role: !!serviceKey,
  host: url ? new URL(url).host : null,
  error: _initError
});
