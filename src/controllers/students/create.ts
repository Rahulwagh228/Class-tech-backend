import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import supabase from '../../config/connectSupabase.js';
import { env } from '../../config/env.js';
import type { Student, StudentInput, UserResponse } from '../../models/User.model.js';

// Matches the users.username CHECK constraint: ^[a-zA-Z0-9_.-]{3,30}$
const USERNAME_REGEX = /^[a-zA-Z0-9_.-]{3,30}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalize(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

// =============================================================================
// POST /api/v1/students/check-username
//
// Live validation for the "Add Student" form. Username uniqueness is scoped
// per-tution (same as register), so tution_id comes from the JWT.
//
// Body: { username: string }
//
// Response 200 (available):
//   { available: true }
//
// Response 200 (taken):
//   { available: false, msg: 'this username is already taken' }
//
// Response 400 (bad format):
//   { available: false, msg: 'username must be 3-30 chars, letters/digits/._- only' }
//
// Errors:
//   401 — not authenticated
//   500 — server error
// =============================================================================
export const checkUsername = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ msg: 'Authentication required' });
      return;
    }
    const tution_id = req.user.tution_id;
    if (!tution_id) {
      res.status(400).json({ msg: 'Token has no tution_id' });
      return;
    }

    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';

    if (!username) {
      res.status(400).json({ available: false, msg: 'username is required' });
      return;
    }
    if (!USERNAME_REGEX.test(username)) {
      res.status(400).json({
        available: false,
        msg: 'username must be 3-30 chars, letters/digits/._- only'
      });
      return;
    }

    const { data: existing, error } = await supabase
      .from('users')
      .select('id')
      .eq('tution_id', tution_id)
      .eq('username', username)
      .maybeSingle();

    if (error) {
      console.error('checkUsername: lookup failed:', error);
      res.status(500).json({ msg: 'Server error' });
      return;
    }

    if (existing) {
      res.status(200).json({ available: false, msg: 'this username is already taken' });
      return;
    }

    res.status(200).json({ available: true });
  } catch (err) {
    console.error('checkUsername error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};

// =============================================================================
// POST /api/v1/students/create
//
// Add a single student via the admin/teacher "Add Student" form.
// tution_id and the actor are derived from the JWT.
//
// Body:
// {
//   name:     string,                  // required
//   username: string,                  // required, 3-30 chars [a-zA-Z0-9_.-]
//   email:    string,                  // required
//   password: string,                  // required, min 8 chars
//   profile_photo?: string | null,
//
//   enrollment_number: string,         // required
//   date_of_birth?:    string | null,  // ISO date "YYYY-MM-DD"
//   gender?:           string | null,
//   grade_level?:      string | null,
//   section?:          string | null,
//   blood_group?:      string | null,
//   guardian_name?:    string | null,
//   guardian_phone?:   string | null,
//   emergency_contact?: string | null,
//   address?:          string | null,
//   admission_date?:   string | null,  // ISO date
//   notes?:            string | null
// }
//
// Response 201:
//   {
//     msg: 'Student created successfully',
//     user:    { id, tution_id, name, username, email, profile_photo,
//                role, email_verified, created_at, updated_at },
//     student: { user_id, tution_id, enrollment_number, date_of_birth,
//                gender, grade_level, section, blood_group, guardian_name,
//                guardian_phone, emergency_contact, address, admission_date,
//                notes, created_at, updated_at }
//   }
//
// Errors:
//   400 — missing/invalid fields
//   401 — not authenticated
//   403 — caller is not admin/teacher
//   409 — email or username already exists
//   500 — server error
// =============================================================================
export const createStudent = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ msg: 'Authentication required' });
      return;
    }
    const tution_id = req.user.tution_id;
    if (!tution_id) {
      res.status(400).json({ msg: 'Token has no tution_id' });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const email = normalize(body.email);
    const password = typeof body.password === 'string' ? body.password : '';
    const profile_photo =
      typeof body.profile_photo === 'string' && body.profile_photo.trim().length > 0
        ? body.profile_photo.trim()
        : null;

    const studentInput = body as unknown as StudentInput;
    const enrollment_number =
      typeof studentInput.enrollment_number === 'string'
        ? studentInput.enrollment_number.trim()
        : '';

    // ── Validate ─────────────────────────────────────────────────────────────
    if (!name) {
      res.status(400).json({ msg: 'name is required' });
      return;
    }
    if (!username) {
      res.status(400).json({ msg: 'username is required' });
      return;
    }
    if (!USERNAME_REGEX.test(username)) {
      res.status(400).json({ msg: 'username must be 3-30 chars, letters/digits/._- only' });
      return;
    }
    if (!email || !EMAIL_REGEX.test(email)) {
      res.status(400).json({ msg: 'a valid email is required' });
      return;
    }
    if (!password || password.length < 8) {
      res.status(400).json({ msg: 'password must be at least 8 characters' });
      return;
    }
    if (!enrollment_number) {
      res.status(400).json({ msg: 'enrollment_number is required' });
      return;
    }

    // ── Uniqueness: email is global, (tution_id, username) is per-tution ─────
    const { data: conflictRows, error: conflictErr } = await supabase
      .from('users')
      .select('email, username, tution_id')
      .or(`email.eq.${email},and(tution_id.eq.${tution_id},username.eq.${username})`)
      .limit(1);

    if (conflictErr) {
      console.error('createStudent: conflict check failed:', conflictErr);
      res.status(500).json({ msg: 'Server error' });
      return;
    }

    const conflict = conflictRows?.[0] as
      | { email: string; username: string; tution_id: string }
      | undefined;
    if (conflict) {
      res.status(409).json({
        msg:
          conflict.email === email
            ? 'Email already exists'
            : 'this username is already taken'
      });
      return;
    }

    // ── Insert user ──────────────────────────────────────────────────────────
    const password_hash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);

    const { data: user, error: userErr } = await supabase
      .from('users')
      .insert({
        tution_id,
        name,
        username,
        email,
        password_hash,
        profile_photo,
        role: 'student',
        email_verified: false
      })
      .select(
        'id, tution_id, name, username, email, profile_photo, role, email_verified, created_at, updated_at'
      )
      .single<UserResponse>();

    if (userErr || !user) {
      console.error('createStudent: user insert failed:', userErr);
      res.status(500).json({ msg: userErr?.message ?? 'Failed to create user' });
      return;
    }

    // ── Insert student profile (rollback user on failure) ───────────────────
    const { data: student, error: studentErr } = await supabase
      .from('students')
      .insert({
        user_id: user.id,
        tution_id,
        enrollment_number,
        date_of_birth: studentInput.date_of_birth ?? null,
        gender: studentInput.gender ?? null,
        grade_level: studentInput.grade_level ?? null,
        section: studentInput.section ?? null,
        blood_group: studentInput.blood_group ?? null,
        guardian_name: studentInput.guardian_name ?? null,
        guardian_phone: studentInput.guardian_phone ?? null,
        emergency_contact: studentInput.emergency_contact ?? null,
        address: studentInput.address ?? null,
        admission_date: studentInput.admission_date ?? null,
        notes: studentInput.notes ?? null
      })
      .select('*')
      .single<Student>();

    if (studentErr || !student) {
      console.error('createStudent: student insert failed:', studentErr);
      await supabase.from('users').delete().eq('id', user.id);
      res.status(500).json({
        msg: studentErr?.message ?? 'Failed to create student profile',
        hint: 'Common cause: duplicate enrollment_number within this tution.'
      });
      return;
    }

    res.status(201).json({
      msg: 'Student created successfully',
      user,
      student
    });
  } catch (err) {
    console.error('createStudent error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};
