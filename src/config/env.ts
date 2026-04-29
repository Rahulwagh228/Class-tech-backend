import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.string().default('info'),

  // Was: required min(16). Made optional so a missing var doesn't crash the
  // whole serverless function on cold start. Routes that need it should fail
  // gracefully (return 500 with a clear message) rather than the entire app
  // refusing to load.
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters').optional(),
  JWT_EXPIRES_IN: z.string().default('7d'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),

  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(1).optional(),
  APP_URL: z.string().url().default('http://localhost:3000'),

  // Optional - only needed if you switch back to direct Postgres
  DATABASE_URL: z.string().url().optional(),

  // ---------------------------------------------------------------------------
  // Supabase  (accept both bare and NEXT_PUBLIC_-prefixed names)
  // ---------------------------------------------------------------------------
  SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional()
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Don't throw - log a structured error and use empty env so the function
  // can still boot and serve /health, /_diag for debugging.
  console.error('[env] validation failed:', parsed.error.flatten());
}

export const env = parsed.success ? parsed.data : envSchema.parse({});

// Quick boot summary - shows up in Vercel function logs on cold start.
console.log('[env] loaded', {
  NODE_ENV: env.NODE_ENV,
  has_JWT_SECRET: !!env.JWT_SECRET,
  has_RESEND_API_KEY: !!env.RESEND_API_KEY,
  has_EMAIL_FROM: !!env.EMAIL_FROM,
  has_SUPABASE_URL: !!(env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL),
  has_SUPABASE_KEY: !!(
    env.SUPABASE_SERVICE_ROLE_KEY ??
    env.SUPABASE_PUBLISHABLE_KEY ??
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ),
  has_SUPABASE_SERVICE_ROLE_KEY: !!env.SUPABASE_SERVICE_ROLE_KEY
});
