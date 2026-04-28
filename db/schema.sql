-- =============================================================================
-- Class Tech - Auth schema (PostgreSQL 13+)
-- =============================================================================
-- Run once on a fresh database:
--   psql "$DATABASE_URL" -f db/schema.sql
-- =============================================================================

-- gen_random_uuid() lives in pgcrypto on older Postgres; built-in on PG 13+.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Case-insensitive text type for email (so "A@x.com" == "a@x.com" automatically).
CREATE EXTENSION IF NOT EXISTS "citext";

-- -----------------------------------------------------------------------------
-- ENUM: user roles
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM ('admin', 'student', 'parent');
  END IF;
END$$;

-- -----------------------------------------------------------------------------
-- TABLE: users
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),

  name                            VARCHAR(80)     NOT NULL,
  username                        VARCHAR(30)     NOT NULL,
  email                           CITEXT          NOT NULL,
  password_hash                   VARCHAR(255)    NOT NULL,
  profile_photo                   VARCHAR(2048),

  role                            user_role       NOT NULL,

  email_verified                  BOOLEAN         NOT NULL DEFAULT FALSE,
  email_verification_token        VARCHAR(128),
  email_verification_expires_at   TIMESTAMPTZ,

  created_at                      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

  CONSTRAINT users_username_format
    CHECK (username ~ '^[a-zA-Z0-9_.-]{3,30}$'),
  CONSTRAINT users_email_format
    CHECK (POSITION('@' IN email) > 1)
);

-- -----------------------------------------------------------------------------
-- INDEXES
-- -----------------------------------------------------------------------------
-- Unique lookups (also enforces uniqueness)
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key    ON users (email);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_key ON users (username);

-- Verification token lookup (partial: only rows that still have a token)
CREATE UNIQUE INDEX IF NOT EXISTS users_verification_token_key
  ON users (email_verification_token)
  WHERE email_verification_token IS NOT NULL;

-- Filter by role (admin dashboards, etc.)
CREATE INDEX IF NOT EXISTS users_role_idx ON users (role);

-- -----------------------------------------------------------------------------
-- TRIGGER: auto-update updated_at on every UPDATE
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_set_updated_at ON users;
CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
