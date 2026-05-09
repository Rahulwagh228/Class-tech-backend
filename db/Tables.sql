
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
ALTER TABLE users

ADD CONSTRAINT users_username_unique UNIQUE (username);
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


-- =============================================================================
-- 3.4 students  (1:1 with users where role='student')
--   user_id is BOTH primary key AND foreign key -> guarantees one student row
--   per user. ON DELETE CASCADE -> deleting the user deletes the student row.
-- ===
-- students (1:1 with users where role='student')
CREATE TABLE students (
  user_id            UUID          PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tution_id          UUID          NOT NULL    REFERENCES Tutions(id) ON DELETE CASCADE,

  enrollment_number  VARCHAR(40)   NOT NULL,
  date_of_birth      DATE,
  gender             VARCHAR(20),
  grade_level        VARCHAR(20),
  section            VARCHAR(20),
  blood_group        VARCHAR(5),

  guardian_name      VARCHAR(80),
  guardian_phone     VARCHAR(20),
  emergency_contact  VARCHAR(20),

  address            TEXT,
  admission_date     DATE          DEFAULT CURRENT_DATE,
  notes              TEXT,

  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT students_enrollment_unique UNIQUE (tution_id, enrollment_number)
);
CREATE INDEX students_tution_idx        ON students (tution_id);


-- teachers (1:1 with users where role='teacher')
CREATE TABLE teachers (
  user_id           UUID          PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tution_id         UUID          NOT NULL    REFERENCES Tutions(id) ON DELETE CASCADE,

  employee_id       VARCHAR(40)   NOT NULL,
  date_of_birth     DATE,
  gender            VARCHAR(20),

  qualification     VARCHAR(200),
  specialization    VARCHAR(200),
  experience_years  INTEGER       CHECK (experience_years IS NULL OR experience_years >= 0),
  joining_date      DATE          DEFAULT CURRENT_DATE,

  bio               TEXT,
  phone             VARCHAR(20),
  address           TEXT,

  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT teachers_employee_unique UNIQUE (tution_id, employee_id)
);
CREATE INDEX teachers_tution_idx ON teachers (tution_id);


CREATE TABLE batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  tution_id UUID NOT NULL REFERENCES tutions(id) ON DELETE CASCADE,

  name VARCHAR(100) NOT NULL,
  code VARCHAR(50) UNIQUE NOT NULL,

  subject VARCHAR(100),
  description TEXT,

  schedule VARCHAR(100),

  teacher_id UUID REFERENCES users(id),

  start_date DATE NOT NULL,
  end_date DATE,

  created_at TIMESTAMPTZ DEFAULT NOW()
);