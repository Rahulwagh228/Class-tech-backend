import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env.js';

// Accept either bare or NEXT_PUBLIC_-prefixed names so the user's pasted
// .env keys work without a rename.
const url = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;

// Prefer the service role key on the server (bypasses RLS).
// Fall back to the publishable / anon key. Warn loudly when falling back -
// most write operations on protected tables will be blocked by RLS otherwise.
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = env.SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const key = serviceKey ?? anonKey;

if (!url || !key) {
  throw new Error(
    'Supabase config missing. Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and ' +
      'SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_PUBLISHABLE_KEY) in your .env.'
  );
}

if (!serviceKey) {
  console.warn(
    '[supabase] WARNING: using publishable/anon key on the server. ' +
      'INSERT/UPDATE on protected tables will be blocked by RLS. ' +
      'Set SUPABASE_SERVICE_ROLE_KEY for backend usage.'
  );
}

const supabase: SupabaseClient = createClient(url, key, {
  auth: {
    // Server-side: don't try to persist sessions / refresh tokens.
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false
  }
});

console.log('[supabase] client ready ->', new URL(url).host);

export default supabase;
