export type ChatbotRole = 'admin' | 'teacher' | 'student' | 'parent'

export interface TableInfo {
  columns: Array<[name: string, type: string]>
  description: string
  tenantColumn?: string
}

export const SCHEMA_CONTEXT: Record<string, TableInfo> = {
  tutions: {
    columns: [
      ['id', 'uuid'],
      ['name', 'varchar'],
      ['slug', 'varchar'],
      ['timezone', 'varchar'],
      ['logo_url', 'varchar'],
      ['created_at', 'timestamptz'],
      ['updated_at', 'timestamptz'],
    ],
    description: 'Tenant root. Each tution is an isolated coaching institute.',
  },
  users: {
    columns: [
      ['id', 'uuid'],
      ['tution_id', 'uuid'],
      ['name', 'varchar'],
      ['username', 'varchar'],
      ['email', 'varchar'],
      ['profile_photo', 'varchar'],
      ['role', 'user_role enum'],
      ['email_verified', 'boolean'],
      ['created_at', 'timestamptz'],
      ['updated_at', 'timestamptz'],
    ],
    description:
      'All accounts (admin, teacher, student, parent). role is an enum: admin | teacher | student | parent. Never expose password_hash.',
    tenantColumn: 'tution_id',
  },
  students: {
    columns: [
      ['user_id', 'uuid'],
      ['tution_id', 'uuid'],
      ['enrollment_number', 'varchar'],
      ['date_of_birth', 'date'],
      ['gender', 'varchar'],
      ['grade_level', 'varchar'],
      ['section', 'varchar'],
      ['blood_group', 'varchar'],
      ['guardian_name', 'varchar'],
      ['guardian_phone', 'varchar'],
      ['emergency_contact', 'varchar'],
      ['address', 'text'],
      ['admission_date', 'date'],
      ['notes', 'text'],
      ['created_at', 'timestamptz'],
      ['updated_at', 'timestamptz'],
    ],
    description:
      'Student profile (1:1 with users where role = student). user_id is both PK and FK to users.id.',
    tenantColumn: 'tution_id',
  },
  teachers: {
    columns: [
      ['user_id', 'uuid'],
      ['tution_id', 'uuid'],
      ['employee_id', 'varchar'],
      ['date_of_birth', 'date'],
      ['gender', 'varchar'],
      ['qualification', 'varchar'],
      ['specialization', 'varchar'],
      ['experience_years', 'integer'],
      ['joining_date', 'date'],
      ['bio', 'text'],
      ['phone', 'varchar'],
      ['address', 'text'],
      ['created_at', 'timestamptz'],
      ['updated_at', 'timestamptz'],
    ],
    description:
      'Teacher profile (1:1 with users where role = teacher). user_id is both PK and FK to users.id.',
    tenantColumn: 'tution_id',
  },
  batches: {
    columns: [
      ['id', 'uuid'],
      ['tution_id', 'uuid'],
      ['name', 'varchar'],
      ['code', 'varchar'],
      ['subject', 'varchar'],
      ['description', 'text'],
      ['schedule', 'jsonb'],
      ['start_date', 'date'],
      ['end_date', 'date'],
      ['created_at', 'timestamptz'],
    ],
    description: 'A batch/class group within a tution. Teachers are linked via batch_teachers.',
    tenantColumn: 'tution_id',
  },
  batch_teachers: {
    columns: [
      ['id', 'uuid'],
      ['tution_id', 'uuid'],
      ['batch_id', 'uuid'],
      ['teacher_user_id', 'uuid'],
      ['is_lead', 'boolean'],
      ['assigned_at', 'timestamptz'],
    ],
    description:
      'Many-to-many join between batches and teacher users. is_lead marks the primary instructor.',
    tenantColumn: 'tution_id',
  },
  attendance_records: {
    columns: [
      ['id', 'uuid'],
      ['tution_id', 'uuid'],
      ['batch_id', 'uuid'],
      ['student_id', 'uuid'],
      ['attendance_date', 'date'],
      ['status', 'attendance_status enum'],
      ['notes', 'text'],
      ['marked_by', 'uuid'],
      ['last_edited_by', 'uuid'],
      ['created_at', 'timestamptz'],
      ['updated_at', 'timestamptz'],
    ],
    description:
      'One row per batch x student x day. status is an enum: present | absent | late | excused. student_id references users.id.',
    tenantColumn: 'tution_id',
  },
  parent_students: {
    columns: [
      ['id', 'uuid'],
      ['tution_id', 'uuid'],
      ['parent_user_id', 'uuid'],
      ['student_user_id', 'uuid'],
      ['relationship', 'varchar'],
      ['is_primary', 'boolean'],
      ['created_at', 'timestamptz'],
    ],
    description:
      'Many-to-many link between parent users and student users. A parent can have multiple children and vice versa.',
    tenantColumn: 'tution_id',
  },
}

const ROLE_SCOPING_RULES: Record<ChatbotRole, (tutionId: string, userId: string) => string> = {
  admin: (tutionId) => `
- You are an ADMIN of tution_id = '${tutionId}'.
- ALWAYS filter every query by tution_id = '${tutionId}' on any table that has a tution_id column.
- You may read across all batches, teachers, students, and parents within this tution.
- Never expose or join data from any other tution.`,

  teacher: (tutionId, userId) => `
- You are a TEACHER. Your user_id = '${userId}', tution_id = '${tutionId}'.
- ALWAYS filter every query by tution_id = '${tutionId}'.
- For batch-scoped data (batches, attendance_records), restrict to batches you teach:
    batch_id IN (SELECT batch_id FROM batch_teachers WHERE teacher_user_id = '${userId}')
- You may read students who belong to those batches via attendance_records.
- Never expose data from batches you do not teach or from other tutions.`,

  student: (tutionId, userId) => `
- You are a STUDENT. Your user_id = '${userId}', tution_id = '${tutionId}'.
- ALWAYS filter every query by tution_id = '${tutionId}'.
- You may only read your OWN records:
    - students: WHERE user_id = '${userId}'
    - attendance_records: WHERE student_id = '${userId}'
    - users: WHERE id = '${userId}'
- Never expose other students' data, teacher PII, or any other tution.`,

  parent: (tutionId, userId) => `
- You are a PARENT. Your user_id = '${userId}', tution_id = '${tutionId}'.
- ALWAYS filter every query by tution_id = '${tutionId}'.
- You may only read data for students linked to you via parent_students:
    student_id IN (SELECT student_user_id FROM parent_students WHERE parent_user_id = '${userId}')
- Applies to attendance_records.student_id, students.user_id, and users.id when referring to your children.
- Never expose data for unlinked students or any other tution.`,
}

export interface BuildSchemaPromptArgs {
  role: ChatbotRole
  tutionId: string
  userId: string
}

export function buildSchemaPrompt({ role, tutionId, userId }: BuildSchemaPromptArgs): string {
  const tableDescriptions = Object.entries(SCHEMA_CONTEXT)
    .map(([table, info]) => {
      const cols = info.columns.map(([n, t]) => `${n} ${t}`).join(', ')
      return `- ${table}(${cols}): ${info.description}`
    })
    .join('\n')

  const scopingRules = ROLE_SCOPING_RULES[role](tutionId, userId)

  return `You are a SQL expert for a coaching-institute management system called Classly.
You ONLY generate read-only PostgreSQL SELECT queries.
Never generate INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, GRANT, or any other mutation/DDL statement.
Never reference password_hash or any column not listed in the schema below.

Database schema:
${tableDescriptions}

Enums:
- user_role: admin | teacher | student | parent
- attendance_status: present | absent | late | excused

CRITICAL SCOPING RULES:${scopingRules}

General rules:
- Use explicit JOINs (no implicit comma joins).
- Always qualify columns with table aliases when joining.
- Use parameter-safe literal UUIDs exactly as provided above; do not invent IDs.
- Respect column types shown in the schema above. PostgreSQL does NOT auto-cast between text and integer.
  - varchar / text / date / uuid / enum columns MUST be compared to single-quoted string literals,
    even if the value looks numeric (e.g. enrollment_number = '12345', employee_id = 'EMP07', grade_level = '10').
  - Only integer / numeric / boolean columns may be compared to bare numeric or boolean literals.
- Prefer LIMIT 100 unless the user explicitly asks for more.
- If the request cannot be answered within the scoping rules, return exactly: SELECT NULL WHERE FALSE;

Return ONLY the raw SQL query. No explanation, no markdown, no backticks.`
}
