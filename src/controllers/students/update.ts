import type { Request, Response } from 'express';
import pool from '../../config/connectpsql.js';
import type { Student, UserResponse } from '../../models/User.model.js';

// Matches the users.username CHECK constraint: ^[a-zA-Z0-9_.-]{3,30}$
const USERNAME_REGEX = /^[a-zA-Z0-9_.-]{3,30}$/;

// Fields a student is allowed to change on their own users row.
const USER_EDITABLE_FIELDS = ['name', 'username', 'profile_photo'] as const;

// Fields a student is allowed to change on their own students row.
// (enrollment_number, admission_date, tution_id, user_id, notes are school-controlled.)
const STUDENT_EDITABLE_FIELDS = [
  'date_of_birth',
  'gender',
  'grade_level',
  'section',
  'blood_group',
  'guardian_name',
  'guardian_phone',
  'emergency_contact',
  'address'
] as const;

type UserField = (typeof USER_EDITABLE_FIELDS)[number];
type StudentField = (typeof STUDENT_EDITABLE_FIELDS)[number];

function pickString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

// =============================================================================
// PATCH /api/v1/student/me   (auth required, role=student, email_verified=true)
//
// Lets an authenticated student update their own profile.
//
// Body (all fields optional; send only what changed):
// {
//   // users row
//   name?:          string,
//   username?:      string,           // 3-30 chars [a-zA-Z0-9_.-], unique per tution
//   profile_photo?: string | null,
//
//   // students row
//   date_of_birth?:      string | null,   // ISO date "YYYY-MM-DD"
//   gender?:             string | null,
//   grade_level?:        string | null,
//   section?:            string | null,
//   blood_group?:        string | null,
//   guardian_name?:      string | null,
//   guardian_phone?:     string | null,
//   emergency_contact?:  string | null,
//   address?:            string | null
// }
//
// Response 200:
//   {
//     msg: 'Profile updated',
//     user:    { id, tution_id, name, username, email, profile_photo, role,
//                email_verified, created_at, updated_at },
//     student: { user_id, tution_id, enrollment_number, ..., created_at, updated_at }
//   }
//
// Errors:
//   400 — no editable fields provided / bad username / body is not an object
//   401 — not authenticated
//   403 — not a student, OR email_verified = false ("verify your email first")
//   404 — student profile row not found
//   409 — username already taken in this tution
//   500 — server error
// =============================================================================
export const updateOwnProfile = async (req: Request, res: Response): Promise<void> => {
  const client = await pool.connect();
  try {
    if (!req.user) {
      res.status(401).json({ msg: 'Authentication required' });
      return;
    }
    if (req.user.role !== 'student') {
      res.status(403).json({ msg: 'Only students can edit their own profile here' });
      return;
    }
    const userId = req.user.id;
    const tution_id = req.user.tution_id;
    if (!tution_id) {
      res.status(400).json({ msg: 'Token has no tution_id' });
      return;
    }

    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      res.status(400).json({ msg: 'Request body must be a JSON object' });
      return;
    }
    const input = body as Record<string, unknown>;

    // -------------------------------------------------------------------------
    // Gate: email must be verified before self-edit is allowed.
    // -------------------------------------------------------------------------
    const gate = await client.query<{ email_verified: boolean }>(
      `SELECT email_verified FROM users WHERE id = $1 AND tution_id = $2`,
      [userId, tution_id]
    );
    const gateRow = gate.rows[0];
    if (!gateRow) {
      res.status(404).json({ msg: 'User not found' });
      return;
    }
    if (!gateRow.email_verified) {
      res.status(403).json({
        msg: 'Please verify your email before editing your profile',
        code: 'EMAIL_NOT_VERIFIED'
      });
      return;
    }

    // -------------------------------------------------------------------------
    // Collect users-table updates
    // -------------------------------------------------------------------------
    const userUpdates: Partial<Record<UserField, string | null>> = {};

    if ('name' in input) {
      const v = pickString(input.name);
      if (v === undefined) {
        res.status(400).json({ msg: 'name must be a string' });
        return;
      }
      if (v === null) {
        res.status(400).json({ msg: 'name cannot be empty' });
        return;
      }
      userUpdates.name = v;
    }

    if ('username' in input) {
      const v = pickString(input.username);
      if (v === undefined || v === null) {
        res.status(400).json({ msg: 'username must be a non-empty string' });
        return;
      }
      if (!USERNAME_REGEX.test(v)) {
        res.status(400).json({
          msg: 'username must be 3-30 chars, letters/digits/._- only'
        });
        return;
      }
      userUpdates.username = v;
    }

    if ('profile_photo' in input) {
      const v = pickString(input.profile_photo);
      if (v === undefined) {
        res.status(400).json({ msg: 'profile_photo must be a string or null' });
        return;
      }
      userUpdates.profile_photo = v;
    }

    // -------------------------------------------------------------------------
    // Collect students-table updates
    // -------------------------------------------------------------------------
    const studentUpdates: Partial<Record<StudentField, string | null>> = {};
    for (const field of STUDENT_EDITABLE_FIELDS) {
      if (!(field in input)) continue;
      const v = pickString(input[field]);
      if (v === undefined) {
        res.status(400).json({ msg: `${field} must be a string or null` });
        return;
      }
      studentUpdates[field] = v;
    }

    const userKeys = Object.keys(userUpdates) as UserField[];
    const studentKeys = Object.keys(studentUpdates) as StudentField[];

    if (userKeys.length === 0 && studentKeys.length === 0) {
      res.status(400).json({ msg: 'No editable fields provided' });
      return;
    }

    // -------------------------------------------------------------------------
    // Transaction: pre-check username uniqueness, then update both tables.
    // -------------------------------------------------------------------------
    await client.query('BEGIN');

    if (userUpdates.username !== undefined) {
      const dup = await client.query<{ id: string }>(
        `SELECT id
           FROM users
          WHERE tution_id = $1
            AND username = $2
            AND id <> $3
          LIMIT 1`,
        [tution_id, userUpdates.username, userId]
      );
      if (dup.rows[0]) {
        await client.query('ROLLBACK');
        res.status(409).json({ msg: 'this username is already taken' });
        return;
      }
    }

    let updatedUser: UserResponse | null = null;
    if (userKeys.length > 0) {
      const setParts: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      for (const key of userKeys) {
        setParts.push(`${key} = $${i++}`);
        params.push(userUpdates[key] ?? null);
      }
      setParts.push('updated_at = NOW()');
      params.push(userId, tution_id);
      const sql = `
        UPDATE users
           SET ${setParts.join(', ')}
         WHERE id = $${i++} AND tution_id = $${i}
         RETURNING id, tution_id, name, username, email, profile_photo, role,
                   email_verified, created_at, updated_at
      `;
      const result = await client.query<UserResponse>(sql, params);
      updatedUser = result.rows[0] ?? null;
      if (!updatedUser) {
        await client.query('ROLLBACK');
        res.status(404).json({ msg: 'User not found' });
        return;
      }
    }

    let updatedStudent: Student | null = null;
    if (studentKeys.length > 0) {
      const setParts: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      for (const key of studentKeys) {
        setParts.push(`${key} = $${i++}`);
        params.push(studentUpdates[key] ?? null);
      }
      setParts.push('updated_at = NOW()');
      params.push(userId, tution_id);
      const sql = `
        UPDATE students
           SET ${setParts.join(', ')}
         WHERE user_id = $${i++} AND tution_id = $${i}
         RETURNING *
      `;
      const result = await client.query<Student>(sql, params);
      updatedStudent = result.rows[0] ?? null;
      if (!updatedStudent) {
        await client.query('ROLLBACK');
        res.status(404).json({ msg: 'Student profile not found' });
        return;
      }
    }

    // If the caller only sent user-scoped fields, still return the current
    // student row so the client can refresh its state in one shot.
    if (!updatedStudent) {
      const result = await client.query<Student>(
        `SELECT * FROM students WHERE user_id = $1 AND tution_id = $2`,
        [userId, tution_id]
      );
      updatedStudent = result.rows[0] ?? null;
    }

    // Same for the user row when only student-scoped fields were sent.
    if (!updatedUser) {
      const result = await client.query<UserResponse>(
        `SELECT id, tution_id, name, username, email, profile_photo, role,
                email_verified, created_at, updated_at
           FROM users
          WHERE id = $1 AND tution_id = $2`,
        [userId, tution_id]
      );
      updatedUser = result.rows[0] ?? null;
    }

    await client.query('COMMIT');

    res.status(200).json({
      msg: 'Profile updated',
      user: updatedUser,
      student: updatedStudent
    });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore rollback error */
    }
    // Postgres unique-violation on (tution_id, username)
    if ((err as { code?: string }).code === '23505') {
      res.status(409).json({ msg: 'this username is already taken' });
      return;
    }
    console.error('updateOwnProfile error:', err);
    res.status(500).json({ msg: 'Server error' });
  } finally {
    client.release();
  }
};
