-- Enable the pgvector extension
create extension if not exists vector;

-- Create the documents table
create table documents (
  id bigserial primary key,
  content text not null,
  metadata jsonb,
  embedding vector(384)  -- 384 for nomic-embed, 1536 for OpenAI
);

-- Create an index for fast similarity search
create index on documents 
using ivfflat (embedding vector_cosine_ops)
with (lists = 100);

-- ============================================================
-- BUNNY BOT: Read-Only Role Setup
-- Safe to run once. Creates role, grants current + future access.
-- ============================================================

-- 1. Create the read-only role
CREATE ROLE bunny_readonly;

-- 2. Allow the role to see the public schema
GRANT USAGE ON SCHEMA public TO bunny_readonly;

-- 3. Grant SELECT on all tables that exist RIGHT NOW
GRANT SELECT ON ALL TABLES IN SCHEMA public TO bunny_readonly;

-- 4. Grant SELECT on all FUTURE tables automatically
--    (postgres is the default table owner in Supabase)
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT ON TABLES TO bunny_readonly;

-- 5. Grant access to all existing sequences (needed for some joins)
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO bunny_readonly;

-- 6. Grant access to future sequences too
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT ON SEQUENCES TO bunny_readonly;

-- 7. Grant execute on existing functions (for the RPC we'll add in Step 4)
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO bunny_readonly;

-- 8. Grant execute on future functions too
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO bunny_readonly;

-- 9. Create the actual DB user and assign the role
CREATE USER bunny_bot WITH PASSWORD 'replace_with_a_strong_password';
GRANT bunny_readonly TO bunny_bot;

-- ============================================================
-- Verification: run this to confirm it worked
-- ============================================================
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'bunny_readonly'
ORDER BY table_name;