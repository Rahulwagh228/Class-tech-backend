import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import supabase from '../../config/connectSupabase.js';
import { env } from '../../config/env.js';
import type { Teacher, TeacherInput, UserResponse } from '../../models/User.model.js';

// Matches the users.username CHECK constraint: ^[a-zA-Z0-9_.-]{3,30}$
const USERNAME_REGEX = /^[a-zA-Z0-9_.-]{3,30}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalize(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

// =============================================================================
// POST /api/v1/teachers/check-username
//
// Live validation for the "Add Teacher" form. Username uniqueness is scoped
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
export const checkTeacherUsername = async (req: Request, res: Response): Promise<void> => {
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
      console.error('checkTeacherUsername: lookup failed:', error);
      res.status(500).json({ msg: 'Server error' });
      return;
    }

    if (existing) {
      res.status(200).json({ available: false, msg: 'this username is already taken' });
      return;
    }

    res.status(200).json({ available: true });
  } catch (err) {
    console.error('checkTeacherUsername error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};

// =============================================================================
// POST /api/v1/teachers/create
//
// Add a single teacher via the admin "Add Teacher" form.
// tution_id and the actor are derived from the JWT (admin only).
//
// Body:
// {
//   name:     string,                  // required
//   username: string,                  // required, 3-30 chars [a-zA-Z0-9_.-]
//   email:    string,                  // required
//   password: string,                  // required, min 8 chars
//   profile_photo?: string | null,
//
//   employee_id:       string,         // required, unique per tution
//   date_of_birth?:    string | null,  // ISO date "YYYY-MM-DD"
//   gender?:           string | null,
//   qualification?:    string | null,
//   specialization?:   string | null,
//   experience_years?: number | null,  // integer >= 0
//   joining_date?:     string | null,  // ISO date (defaults to today)
//   bio?:              string | null,
//   phone?:            string | null,
//   address?:          string | null
// }
//
// Response 201:
//   {
//     msg: 'Teacher created successfully',
//     user:    { id, tution_id, name, username, email, profile_photo,
//                role, email_verified, created_at, updated_at },
//     teacher: { user_id, tution_id, employee_id, date_of_birth, gender,
//                qualification, specialization, experience_years,
//                joining_date, bio, phone, address, created_at, updated_at }
//   }
//
// Errors:
//   400 — missing/invalid fields
//   401 — not authenticated
//   403 — caller is not admin
//   409 — email or username already exists
//   500 — server error (student insert auto-rolls back the user row;
//                       common cause: duplicate employee_id)
// =============================================================================
export const createTeacher = async (req: Request, res: Response): Promise<void> => {
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

    const teacherInput = body as unknown as TeacherInput;
    const employee_id =
      typeof teacherInput.employee_id === 'string' ? teacherInput.employee_id.trim() : '';

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
    if (!employee_id) {
      res.status(400).json({ msg: 'employee_id is required' });
      return;
    }

    // experience_years must be a non-negative integer if provided
    let experience_years: number | null = null;
    if (teacherInput.experience_years !== undefined && teacherInput.experience_years !== null) {
      const n = Number(teacherInput.experience_years);
      if (!Number.isInteger(n) || n < 0) {
        res.status(400).json({ msg: 'experience_years must be a non-negative integer' });
        return;
      }
      experience_years = n;
    }

    // ── Uniqueness: email is global, (tution_id, username) is per-tution ─────
    const { data: conflictRows, error: conflictErr } = await supabase
      .from('users')
      .select('email, username, tution_id')
      .or(`email.eq.${email},and(tution_id.eq.${tution_id},username.eq.${username})`)
      .limit(1);

    if (conflictErr) {
      console.error('createTeacher: conflict check failed:', conflictErr);
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
        role: 'teacher',
        email_verified: false
      })
      .select(
        'id, tution_id, name, username, email, profile_photo, role, email_verified, created_at, updated_at'
      )
      .single<UserResponse>();

    if (userErr || !user) {
      console.error('createTeacher: user insert failed:', userErr);
      res.status(500).json({ msg: userErr?.message ?? 'Failed to create user' });
      return;
    }

    // ── Insert teacher profile (rollback user on failure) ────────────────────
    const { data: teacher, error: teacherErr } = await supabase
      .from('teachers')
      .insert({
        user_id: user.id,
        tution_id,
        employee_id,
        date_of_birth: teacherInput.date_of_birth ?? null,
        gender: teacherInput.gender ?? null,
        qualification: teacherInput.qualification ?? null,
        specialization: teacherInput.specialization ?? null,
        experience_years,
        joining_date: teacherInput.joining_date ?? null,
        bio: teacherInput.bio ?? null,
        phone: teacherInput.phone ?? null,
        address: teacherInput.address ?? null
      })
      .select('*')
      .single<Teacher>();

    if (teacherErr || !teacher) {
      console.error('createTeacher: teacher insert failed:', teacherErr);
      await supabase.from('users').delete().eq('id', user.id);
      res.status(500).json({
        msg: teacherErr?.message ?? 'Failed to create teacher profile',
        hint: 'Common cause: duplicate employee_id within this tution.'
      });
      return;
    }

    res.status(201).json({
      msg: 'Teacher created successfully',
      user,
      teacher
    });
  } catch (err) {
    console.error('createTeacher error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};
