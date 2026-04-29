import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.string().default('info'),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),

  RESEND_API_KEY: z.string().min(1),
  EMAIL_FROM: z.string().min(1),
  APP_URL: z.string().url().default('http://localhost:3000'),

  // Optional - only needed if you switch back to direct Postgres
  // (uncomment the `pool` import in src/controllers/auth.ts)
  DATABASE_URL: z
    .string()
    .url('DATABASE_URL must be a valid Postgres connection string')
    .optional(),

  // ---------------------------------------------------------------------------
  // Supabase
  // ---------------------------------------------------------------------------
  // SUPABASE_URL is the project URL (e.g. https://xxxxx.supabase.co).
  //   The user's .env uses NEXT_PUBLIC_SUPABASE_URL - we accept either.
  // SUPABASE_PUBLISHABLE_KEY is the anon key (safe to expose in browsers).
  // SUPABASE_SERVICE_ROLE_KEY bypasses Row-Level Security - REQUIRED for the
  //   backend to INSERT/UPDATE the users table unless you've written permissive
  //   RLS policies. Get it from: Supabase dashboard -> Project Settings -> API.
  // ---------------------------------------------------------------------------
  SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional()
});

export const env = envSchema.parse(process.env);
