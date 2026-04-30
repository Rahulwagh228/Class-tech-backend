import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import supabase from '../../config/connectSupabase.js';
import { env } from '../../config/env.js';
import type { JwtPayload, User, UserResponse } from '../../models/User.model.js';

// =============================================================================
// POST /api/v1/students/auth/login
//
// Student-specific login. Accepts email OR username + password.
// Returns a signed JWT plus the merged user + student profile (no password_hash).
//
// Body: { identifier: string, password: string }
//   identifier — the student's email address OR username
//   password   — plain-text password (compared against bcrypt hash)
//
// Response 200:
//   {
//     token: string,
//     user: { id, tution_id, name, username, email, profile_photo,
//             role, email_verified, created_at, updated_at },
//     student: { enrollment_number, date_of_birth, gender, grade_level,
//                section, blood_group, guardian_name, guardian_phone,
//                emergency_contact, address, admission_date, notes,
//                created_at, updated_at }
//   }
//
// Errors:
//   400 — missing identifier / password
//   401 — invalid credentials
//   403 — account exists but is not a student
//   500 — server error
// =============================================================================

function normalizeIdentifier(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function signToken(user: Pick<User, 'id' | 'tution_id' | 'role'>): string {
  if (!env.JWT_SECRET) {
    throw new Error('JWT_SECRET is not set in environment');
  }
  const payload: JwtPayload = {
    id: user.id,
    tution_id: user.tution_id,
    role: user.role
  };
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn']
  });
}

export const studentLogin = async (req: Request, res: Response): Promise<void> => {
  try {
    const { password } = req.body ?? {};
    const identifier = normalizeIdentifier(req.body?.identifier);

    console.log(identifier, password, "identfiere and pass");
    
    // ── Validate input ───────────────────────────────────────────────────────
    if (!identifier) {
      res.status(400).json({ msg: 'identifier (email or username) is required' });
      return;
    }
    if (!password || typeof password !== 'string') {
      res.status(400).json({ msg: 'password is required' });
      return;
    }

    // ── Determine if identifier is email or username ─────────────────────────
    const isEmail = identifier.includes('@');

    // ── Fetch user from DB ───────────────────────────────────────────────────
    let query = supabase
      .from('users')
      .select(
        'id, tution_id, name, username, email, password_hash, profile_photo, role, email_verified, created_at, updated_at'
      );

    query = isEmail
      ? query.eq('email', identifier)
      : query.eq('username', identifier);

    const { data: user, error: fetchErr } = await query.maybeSingle<User>();

    if (fetchErr) {
      console.error('studentLogin: user fetch failed:', fetchErr);
      res.status(500).json({ msg: 'Server error' });
      return;
    }

    // Intentionally vague message — don't leak whether the account exists
    if (!user) {
      res.status(401).json({ msg: 'Invalid credentials' });
      return;
    }

    // ── Verify password ──────────────────────────────────────────────────────
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      res.status(401).json({ msg: 'Invalid credentials' });
      return;
    }

    // ── Verify role ──────────────────────────────────────────────────────────
    if (user.role !== 'student') {
      res.status(403).json({ msg: 'This account is not registered as a student' });
      return;
    }

    // ── Sign JWT ─────────────────────────────────────────────────────────────
    const token = signToken(user);

    // Strip password_hash before sending the user object
    const { password_hash: _omit, ...safeUser } = user;
    const userResponse: UserResponse = safeUser as UserResponse;

    res.status(200).json({
      token,
      user: userResponse
    });
  } catch (err) {
    console.error('studentLogin error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};
