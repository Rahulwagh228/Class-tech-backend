-- =============================================================================
-- Class Tech - Full database schema (PostgreSQL 13+)
-- =============================================================================
-- Multi-tenant SaaS for classes management.
--   Tenant            = a school (one row in `schools`)
--   Every domain row  = scoped by school_id
--
-- Apply once on a fresh database:
--   createdb class_tech
--   psql "postgres://user:pass@localhost:5432/class_tech" -f db/schema.sql
--
-- Conventions:
--   * primary keys     : UUID, default gen_random_uuid()
--   * timestamps       : TIMESTAMPTZ, default NOW()
--   * money            : stored as BIGINT cents (avoid float)
--   * email            : CITEXT (case-insensitive)
--   * delete strategy  : ON DELETE CASCADE (tenant rows die with their parents)
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0. EXTENSIONS
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";     -- case-insensitive text


-- -----------------------------------------------------------------------------
-- 1. ENUMS
-- -----------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM ('admin', 'teacher', 'student', 'parent');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'class_status') THEN
    CREATE TYPE class_status AS ENUM ('active', 'archived', 'draft');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enrollment_status') THEN
    CREATE TYPE enrollment_status AS ENUM ('active', 'dropped', 'completed');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'attendance_status') THEN
    CREATE TYPE attendance_status AS ENUM ('present', 'absent', 'late', 'excused');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'submission_status') THEN
    CREATE TYPE submission_status AS ENUM ('pending', 'submitted', 'graded', 'late');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invoice_status') THEN
    CREATE TYPE invoice_status AS ENUM ('draft', 'sent', 'paid', 'overdue', 'cancelled');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status') THEN
    CREATE TYPE payment_status AS ENUM ('pending', 'succeeded', 'failed', 'refunded');
  END IF;
END $$;


-- -----------------------------------------------------------------------------
-- 2. updated_at trigger function (reused by every table that has updated_at)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- =============================================================================
-- 3. CORE TENANCY + IDENTITY
-- =============================================================================

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
CREATE TRIGGER tutions_set_updated_at BEFORE UPDATE ON Tutions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- 3.2 users  (admin / teacher / student / parent)
CREATE TABLE users (
  id                              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id                       UUID          NOT NULL REFERENCES schools(id) ON DELETE CASCADE,

  name                            VARCHAR(80)   NOT NULL,
  username                        VARCHAR(30)   NOT NULL,
  email                           CITEXT        NOT NULL,
  password_hash                   VARCHAR(255)  NOT NULL,
  profile_photo                   VARCHAR(2048),

  role                            user_role     NOT NULL,

  email_verified                  BOOLEAN       NOT NULL DEFAULT FALSE,
  email_verification_token        VARCHAR(128),
  email_verification_expires_at   TIMESTAMPTZ,

  created_at                      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT users_username_format CHECK (username ~ '^[a-zA-Z0-9_.-]{3,30}$'),
  CONSTRAINT users_email_format    CHECK (POSITION('@' IN email) > 1)
);
CREATE UNIQUE INDEX users_email_key            ON users (email);                      -- global
CREATE UNIQUE INDEX users_school_username_key  ON users (school_id, username);        -- per school
CREATE UNIQUE INDEX users_verification_token_key
  ON users (email_verification_token) WHERE email_verification_token IS NOT NULL;
CREATE INDEX        users_school_role_idx      ON users (school_id, role);
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- 3.3 parent_student_links  (parents <-> students, many-to-many)
CREATE TABLE parent_student_links (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_id    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  relationship  VARCHAR(20)  NOT NULL DEFAULT 'guardian', -- mother | father | guardian | other
  is_primary    BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT parent_student_unique UNIQUE (parent_id, student_id),
  CONSTRAINT parent_student_distinct CHECK (parent_id <> student_id)
);
CREATE INDEX parent_student_parent_idx  ON parent_student_links (parent_id);
CREATE INDEX parent_student_student_idx ON parent_student_links (student_id);

-- Guard role correctness with a trigger (parent.role='parent', student.role='student')
CREATE OR REPLACE FUNCTION enforce_parent_student_roles() RETURNS TRIGGER AS $$
DECLARE
  p_role user_role;
  s_role user_role;
BEGIN
  SELECT role INTO p_role FROM users WHERE id = NEW.parent_id;
  SELECT role INTO s_role FROM users WHERE id = NEW.student_id;
  IF p_role <> 'parent'  THEN RAISE EXCEPTION 'parent_id must reference a user with role=parent';   END IF;
  IF s_role <> 'student' THEN RAISE EXCEPTION 'student_id must reference a user with role=student'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER parent_student_role_check
  BEFORE INSERT OR UPDATE ON parent_student_links
  FOR EACH ROW EXECUTE FUNCTION enforce_parent_student_roles();


-- =============================================================================
-- 4. ACADEMIC STRUCTURE
-- =============================================================================

-- 4.1 academic_years  (e.g. "2025-2026")
CREATE TABLE academic_years (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   UUID         NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name        VARCHAR(40)  NOT NULL,
  start_date  DATE         NOT NULL,
  end_date    DATE         NOT NULL,
  is_current  BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT academic_years_dates CHECK (end_date > start_date),
  CONSTRAINT academic_years_unique_name UNIQUE (school_id, name)
);
CREATE UNIQUE INDEX academic_years_one_current_per_school
  ON academic_years (school_id) WHERE is_current;


-- 4.2 subjects  (Math, Science, …)
CREATE TABLE subjects (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   UUID         NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name        VARCHAR(80)  NOT NULL,
  code        VARCHAR(20)  NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT subjects_unique_code UNIQUE (school_id, code)
);


-- 4.3 classes  (an offering: subject + grade + section + year)
CREATE TABLE classes (
  id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id          UUID          NOT NULL REFERENCES schools(id)        ON DELETE CASCADE,
  academic_year_id   UUID          NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  subject_id         UUID          NOT NULL REFERENCES subjects(id)       ON DELETE RESTRICT,
  name               VARCHAR(120)  NOT NULL,
  grade_level        VARCHAR(20),                       -- e.g. "Grade 8"
  section            VARCHAR(20),                       -- e.g. "A"
  description        TEXT,
  capacity           INTEGER       CHECK (capacity IS NULL OR capacity > 0),
  status             class_status  NOT NULL DEFAULT 'active',
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX classes_school_idx       ON classes (school_id);
CREATE INDEX classes_year_idx         ON classes (academic_year_id);
CREATE INDEX classes_subject_idx      ON classes (subject_id);
CREATE TRIGGER classes_set_updated_at BEFORE UPDATE ON classes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- 4.4 class_teachers  (which teacher(s) teach which class)
CREATE TABLE class_teachers (
  class_id    UUID         NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  teacher_id  UUID         NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  is_lead     BOOLEAN      NOT NULL DEFAULT FALSE,
  assigned_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (class_id, teacher_id)
);
CREATE INDEX class_teachers_teacher_idx ON class_teachers (teacher_id);
-- Only one lead teacher per class:
CREATE UNIQUE INDEX class_teachers_one_lead_per_class
  ON class_teachers (class_id) WHERE is_lead;


-- 4.5 class_enrollments  (students in classes)
CREATE TABLE class_enrollments (
  id           UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id     UUID               NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id   UUID               NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  status       enrollment_status  NOT NULL DEFAULT 'active',
  enrolled_at  TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
  dropped_at   TIMESTAMPTZ,
  CONSTRAINT class_enrollments_unique UNIQUE (class_id, student_id)
);
CREATE INDEX class_enrollments_student_idx ON class_enrollments (student_id);
CREATE INDEX class_enrollments_class_idx   ON class_enrollments (class_id);


-- =============================================================================
-- 5. SCHEDULING + ATTENDANCE
-- =============================================================================

-- 5.1 class_sessions  (one row per scheduled meeting)
CREATE TABLE class_sessions (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id      UUID         NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  starts_at     TIMESTAMPTZ  NOT NULL,
  ends_at       TIMESTAMPTZ  NOT NULL,
  location      VARCHAR(120),                    -- "Room 204" / "Online"
  meeting_url   VARCHAR(2048),                   -- zoom / meet link
  notes         TEXT,
  cancelled_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT class_sessions_time_order CHECK (ends_at > starts_at)
);
CREATE INDEX class_sessions_class_starts_idx ON class_sessions (class_id, starts_at DESC);


-- 5.2 attendance  (per student per session)
CREATE TABLE attendance (
  id          UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID                NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
  student_id  UUID                NOT NULL REFERENCES users(id)          ON DELETE CASCADE,
  status      attendance_status   NOT NULL,
  marked_by   UUID                REFERENCES users(id) ON DELETE SET NULL,
  marked_at   TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  notes       TEXT,
  CONSTRAINT attendance_unique UNIQUE (session_id, student_id)
);
CREATE INDEX attendance_student_idx ON attendance (student_id);


-- =============================================================================
-- 6. ASSIGNMENTS + SUBMISSIONS
-- =============================================================================

-- 6.1 assignments
CREATE TABLE assignments (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id        UUID          NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  created_by      UUID          NOT NULL REFERENCES users(id)   ON DELETE RESTRICT,
  title           VARCHAR(200)  NOT NULL,
  description     TEXT,
  attachment_url  VARCHAR(2048),
  due_at          TIMESTAMPTZ,
  max_score       NUMERIC(6,2)  CHECK (max_score IS NULL OR max_score > 0),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX assignments_class_due_idx ON assignments (class_id, due_at DESC);
CREATE TRIGGER assignments_set_updated_at BEFORE UPDATE ON assignments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- 6.2 submissions
CREATE TABLE submissions (
  id              UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id   UUID                NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_id      UUID                NOT NULL REFERENCES users(id)        ON DELETE CASCADE,
  content         TEXT,
  attachment_url  VARCHAR(2048),
  status          submission_status   NOT NULL DEFAULT 'pending',
  submitted_at    TIMESTAMPTZ,
  score           NUMERIC(6,2),
  feedback        TEXT,
  graded_by       UUID                REFERENCES users(id) ON DELETE SET NULL,
  graded_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  CONSTRAINT submissions_unique UNIQUE (assignment_id, student_id)
);
CREATE INDEX submissions_student_idx ON submissions (student_id);
CREATE TRIGGER submissions_set_updated_at BEFORE UPDATE ON submissions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =============================================================================
-- 7. ANNOUNCEMENTS
-- =============================================================================
CREATE TABLE announcements (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     UUID          NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id      UUID          REFERENCES classes(id) ON DELETE CASCADE,  -- NULL = school-wide
  author_id     UUID          NOT NULL REFERENCES users(id)   ON DELETE RESTRICT,
  title         VARCHAR(200)  NOT NULL,
  body          TEXT          NOT NULL,
  pinned        BOOLEAN       NOT NULL DEFAULT FALSE,
  published_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX announcements_school_pub_idx ON announcements (school_id, published_at DESC);
CREATE INDEX announcements_class_idx      ON announcements (class_id);
CREATE TRIGGER announcements_set_updated_at BEFORE UPDATE ON announcements
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =============================================================================
-- 8. BILLING  (invoices -> items -> payments)
-- =============================================================================

-- 8.1 invoices  (one per student per billing cycle)
CREATE TABLE invoices (
  id           UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id    UUID            NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id   UUID            NOT NULL REFERENCES users(id)   ON DELETE RESTRICT,
  number       VARCHAR(40)     NOT NULL,
  status       invoice_status  NOT NULL DEFAULT 'draft',
  total_cents  BIGINT          NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  currency     CHAR(3)         NOT NULL DEFAULT 'USD',
  due_date     DATE,
  issued_at    TIMESTAMPTZ,
  paid_at      TIMESTAMPTZ,
  notes        TEXT,
  created_at   TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  CONSTRAINT invoices_unique_number UNIQUE (school_id, number)
);
CREATE INDEX invoices_student_idx        ON invoices (student_id);
CREATE INDEX invoices_school_status_idx  ON invoices (school_id, status);
CREATE TRIGGER invoices_set_updated_at BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- 8.2 invoice_items
CREATE TABLE invoice_items (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id    UUID          NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  class_id      UUID          REFERENCES classes(id) ON DELETE SET NULL,   -- which class the fee is for
  description   VARCHAR(200)  NOT NULL,
  amount_cents  BIGINT        NOT NULL CHECK (amount_cents >= 0),
  quantity      INTEGER       NOT NULL DEFAULT 1 CHECK (quantity > 0),
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX invoice_items_invoice_idx ON invoice_items (invoice_id);


-- 8.3 payments  (records of money received, possibly multiple per invoice)
CREATE TABLE payments (
  id                   UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id           UUID            NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount_cents         BIGINT          NOT NULL CHECK (amount_cents > 0),
  currency             CHAR(3)         NOT NULL DEFAULT 'USD',
  status               payment_status  NOT NULL DEFAULT 'pending',
  provider             VARCHAR(40),                          -- 'stripe' | 'razorpay' | 'cash'
  provider_payment_id  VARCHAR(120),
  paid_at              TIMESTAMPTZ,
  created_at           TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  CONSTRAINT payments_unique_provider UNIQUE (provider, provider_payment_id)
);
CREATE INDEX payments_invoice_idx ON payments (invoice_id);


-- =============================================================================
-- 9. AUTH TOKEN STORES  (refresh + password reset)
-- =============================================================================

-- 9.1 refresh_tokens  (only the SHA-256 hash is stored, never the raw token)
CREATE TABLE refresh_tokens (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  VARCHAR(128) NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ  NOT NULL,
  revoked_at  TIMESTAMPTZ,
  user_agent  TEXT,
  ip          INET,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);


-- 9.2 password_reset_tokens
CREATE TABLE password_reset_tokens (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  VARCHAR(128) NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ  NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX password_reset_tokens_user_idx ON password_reset_tokens (user_id);


-- =============================================================================
-- 10. SEED DATA  (optional - delete if not wanted)
-- =============================================================================
-- INSERT INTO schools (name, slug) VALUES ('Demo Academy', 'demo-academy');
