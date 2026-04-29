
-- 3.1 schools  (tenant root)
CREATE TABLE Tutions (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(120) NOT NULL,
  slug        VARCHAR(60)  NOT NULL UNIQUE,        -- used in URLs / subdomains
  timezone    VARCHAR(64)  NOT NULL DEFAULT 'UTC',
  logo_url    VARCHAR(2048),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT tutions_slug_format CHECK (slug ~ '^[a-z0-9-]{3,60}$')
);


CREATE TYPE user_role AS ENUM (
  'admin',
  'teacher',
  'student',
  'parent'
);

-- 3.2 users  (admin / teacher / student / parent)
CREATE TABLE users (
  id                              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tution_id                       UUID          NOT NULL REFERENCES Tutions(id) ON DELETE CASCADE,

  name                            VARCHAR(80)   NOT NULL,
  username                        VARCHAR(30)   NOT NULL,
  email                           TEXT        NOT NULL,
  password_hash                   VARCHAR(255)  NOT NULL,
  profile_photo                   VARCHAR(2048),

  role                            user_role     NOT NULL,

  email_verified                  BOOLEAN       NOT NULL DEFAULT FALSE,
 
  created_at                      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT users_username_format CHECK (username ~ '^[a-zA-Z0-9_.-]{3,30}$'),
  CONSTRAINT users_email_format    CHECK (POSITION('@' IN email) > 1)
);
CREATE UNIQUE INDEX users_email_unique ON users (LOWER(email));

-- 3.3 email_otps  (one-time codes for email verification)
CREATE TABLE email_otps (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT       NOT NULL,
  otp          VARCHAR(6)   NOT NULL,
  is_verified  BOOLEAN      NOT NULL DEFAULT FALSE,
  expires_at   TIMESTAMPTZ  NOT NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX email_otps_email_idx       ON email_otps (email);
CREATE INDEX email_otps_expires_at_idx  ON email_otps (expires_at);


