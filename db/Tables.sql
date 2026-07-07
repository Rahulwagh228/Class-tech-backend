
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


ALTER TABLE Tutions
ADD CONSTRAINT tutions_created_by_fkey
FOREIGN KEY (created_by) REFERENCES superadmins(id) ON DELETE SET NULL;

ALTER TABLE Tutions
ADD COLUMN created_by UUID,
ADD COLUMN plan VARCHAR(20) NOT NULL DEFAULT 'trial';

ALTER TABLE Tutions
ADD CONSTRAINT tutions_plan_check
CHECK (plan IN ('trial', 'paid_p1', 'paid_p2', 'paid_p3'));


CREATE TYPE user_role AS ENUM (
  'admin',
  'teacher',
  'student',
  'parent'
);

-- updated_at trigger function used by tables with timestamp maintenance
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

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
-- 3.3 superadmins  (global login-only account, not tied to a tenant)
CREATE TABLE superadmins (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT        NOT NULL UNIQUE,
  password_hash   VARCHAR(255)  NOT NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT superadmins_email_format CHECK (POSITION('@' IN email) > 1)
);

CREATE TRIGGER superadmins_set_updated_at BEFORE UPDATE ON superadmins
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE superadmins
ADD COLUMN name VARCHAR(100);

ALTER TABLE superadmins
ADD COLUMN username VARCHAR(50) UNIQUE;


ALTER TABLE superadmins
ADD CONSTRAINT superadmins_username_unique UNIQUE (username);
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

  -- Teachers live in batch_teachers (many-to-many). See section 3.6 below.

  start_date DATE NOT NULL,
  end_date DATE,

  created_at TIMESTAMPTZ DEFAULT NOW()
);


-- =============================================================================
-- batch_teachers  (many-to-many link between batches and teacher users)
--   Allows multiple teachers per batch (e.g. lead + assistant, co-teaching).
--   is_lead = TRUE marks the primary instructor; defaults to FALSE.
--   Attendance ownership checks query this table - any teacher assigned to a
--   batch may mark attendance for it. Lead distinction is purely informational.
-- =============================================================================
CREATE TABLE batch_teachers (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tution_id          UUID         NOT NULL REFERENCES tutions(id) ON DELETE CASCADE,
  batch_id           UUID         NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  teacher_user_id    UUID         NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  is_lead            BOOLEAN      NOT NULL DEFAULT FALSE,
  assigned_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT batch_teachers_unique UNIQUE (batch_id, teacher_user_id)
);
CREATE INDEX batch_teachers_batch_idx   ON batch_teachers (batch_id);
CREATE INDEX batch_teachers_teacher_idx ON batch_teachers (teacher_user_id);
CREATE INDEX batch_teachers_tution_idx  ON batch_teachers (tution_id);


-- =============================================================================
-- MIGRATION  (run on an existing DB that already has batches.teacher_id rows)
-- =============================================================================
-- 1. Create the join table (block above).
-- 2. Backfill existing single-teacher assignments as lead:
--      INSERT INTO batch_teachers (tution_id, batch_id, teacher_user_id, is_lead)
--      SELECT tution_id, id, teacher_id, TRUE
--      FROM batches
--      WHERE teacher_id IS NOT NULL;
-- 3. Drop the old column:
--      ALTER TABLE batches DROP COLUMN teacher_id;
-- =============================================================================


-- =============================================================================
-- 3.5 attendance_records  (one row per batch x student x day)
--   tution_id is denormalized so every read can scope by institution without
--   joining batches. This matches the codebase's tenant-isolation pattern and
--   keeps the row RLS-policy-ready.
-- =============================================================================
CREATE TYPE attendance_status AS ENUM ('present', 'absent', 'late', 'excused');

CREATE TABLE attendance_records (
  id                UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
  tution_id         UUID                NOT NULL REFERENCES tutions(id) ON DELETE CASCADE,
  batch_id          UUID                NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  student_id        UUID                NOT NULL REFERENCES users(id)   ON DELETE CASCADE,

  attendance_date   DATE                NOT NULL,
  status            attendance_status   NOT NULL,
  notes             TEXT,

  marked_by         UUID                NOT NULL REFERENCES users(id),
  last_edited_by    UUID                REFERENCES users(id),

  created_at        TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ         NOT NULL DEFAULT NOW(),

  CONSTRAINT attendance_unique_per_day UNIQUE (batch_id, student_id, attendance_date)
);

CREATE INDEX attendance_tution_idx       ON attendance_records (tution_id);
CREATE INDEX attendance_batch_date_idx   ON attendance_records (batch_id, attendance_date);
CREATE INDEX attendance_student_date_idx ON attendance_records (student_id, attendance_date);


-- =============================================================================
-- 3.6 parent_students  (many-to-many link between parent users and student users)
--   Lets a parent see attendance for any student they're linked to. Many-to-many
--   so a parent can have multiple children and a student can have multiple
--   parents (e.g. shared custody). The unique constraint prevents duplicate
--   links; is_primary flags the default contact.
-- =============================================================================
CREATE TABLE parent_students (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tution_id         UUID         NOT NULL REFERENCES tutions(id) ON DELETE CASCADE,
  parent_user_id    UUID         NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  student_user_id   UUID         NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  relationship      VARCHAR(40),
  is_primary        BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT parent_students_unique UNIQUE (parent_user_id, student_user_id)
);
CREATE INDEX parent_students_parent_idx  ON parent_students (parent_user_id);
CREATE INDEX parent_students_student_idx ON parent_students (student_user_id);
CREATE INDEX parent_students_tution_idx  ON parent_students (tution_id);


-- =============================================================================
-- 3.7 exams
--   An exam is created by an admin for one or more batches and one or more
--   subjects. Marks are recorded per (exam_subject, student) by teachers, and
--   read by students/parents.
--
--   tables:
--     exams           - the exam itself (header)
--     exam_batches    - which batches sit for this exam (M:N)
--     exam_subjects   - subjects/papers within the exam, each with max marks
--     exam_marks      - per (exam_subject x student) marks row, idempotent upsert
-- =============================================================================

CREATE TABLE exams (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tution_id     UUID          NOT NULL REFERENCES tutions(id) ON DELETE CASCADE,

  name          VARCHAR(120)  NOT NULL,
  code          VARCHAR(60)   NOT NULL,
  description   TEXT,

  start_date    DATE          NOT NULL,
  end_date      DATE,

  created_by    UUID          NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT exams_code_unique UNIQUE (tution_id, code),
  CONSTRAINT exams_date_order CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX exams_tution_idx ON exams (tution_id);


-- Which batches sit for an exam. ON DELETE CASCADE so deleting an exam wipes
-- its batch links automatically.
CREATE TABLE exam_batches (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tution_id    UUID         NOT NULL REFERENCES tutions(id) ON DELETE CASCADE,
  exam_id      UUID         NOT NULL REFERENCES exams(id)   ON DELETE CASCADE,
  batch_id     UUID         NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT exam_batches_unique UNIQUE (exam_id, batch_id)
);
CREATE INDEX exam_batches_exam_idx   ON exam_batches (exam_id);
CREATE INDEX exam_batches_batch_idx  ON exam_batches (batch_id);
CREATE INDEX exam_batches_tution_idx ON exam_batches (tution_id);


-- Subjects / papers under an exam. Each carries its own max marks, optional
-- pass marks, and an optional date for the paper.
CREATE TABLE exam_subjects (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tution_id     UUID          NOT NULL REFERENCES tutions(id) ON DELETE CASCADE,
  exam_id       UUID          NOT NULL REFERENCES exams(id)   ON DELETE CASCADE,

  subject       VARCHAR(120)  NOT NULL,
  max_marks     NUMERIC(6,2)  NOT NULL CHECK (max_marks > 0),
  pass_marks    NUMERIC(6,2)  CHECK (pass_marks IS NULL OR (pass_marks >= 0 AND pass_marks <= max_marks)),
  exam_date     DATE,

  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT exam_subjects_unique UNIQUE (exam_id, subject)
);
CREATE INDEX exam_subjects_exam_idx   ON exam_subjects (exam_id);
CREATE INDEX exam_subjects_tution_idx ON exam_subjects (tution_id);


-- Per-student marks for one (exam_subject). tution_id and exam_id are
-- denormalized for fast tenant-scoped reads (mirrors attendance_records).
CREATE TABLE exam_marks (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tution_id         UUID          NOT NULL REFERENCES tutions(id) ON DELETE CASCADE,
  exam_id           UUID          NOT NULL REFERENCES exams(id)   ON DELETE CASCADE,
  exam_subject_id   UUID          NOT NULL REFERENCES exam_subjects(id) ON DELETE CASCADE,
  student_id        UUID          NOT NULL REFERENCES users(id)   ON DELETE CASCADE,

  marks_obtained    NUMERIC(6,2)  NOT NULL CHECK (marks_obtained >= 0),
  remarks           TEXT,
  is_absent         BOOLEAN       NOT NULL DEFAULT FALSE,

  recorded_by       UUID          NOT NULL REFERENCES users(id),
  last_edited_by    UUID          REFERENCES users(id),

  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT exam_marks_unique UNIQUE (exam_subject_id, student_id)
);
CREATE INDEX exam_marks_exam_idx       ON exam_marks (exam_id);
CREATE INDEX exam_marks_student_idx    ON exam_marks (student_id);
CREATE INDEX exam_marks_tution_idx     ON exam_marks (tution_id);
CREATE INDEX exam_marks_subject_idx    ON exam_marks (exam_subject_id);


