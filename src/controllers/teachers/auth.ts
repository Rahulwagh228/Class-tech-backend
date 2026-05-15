import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import supabase from '../../config/connectSupabase.js';
import { env } from '../../config/env.js';
import type { JwtPayload, User, UserResponse } from '../../models/User.model.js';

// =============================================================================
// POST /api/v1/teachers/auth/login
//
// Teacher-specific login. Accepts email OR username + password.
// Returns a signed JWT plus the user record (no password_hash).
//
// Body: { identifier: string, password: string }
//   identifier — the teacher's email address OR username
//   password   — plain-text password (compared against bcrypt hash)
//
// Response 200:
//   {
//     token: string,
//     user: { id, tution_id, name, username, email, profile_photo,
//             role, email_verified, created_at, updated_at }
//   }
//
// Errors:
//   400 — missing identifier / password
//   401 — invalid credentials
//   403 — account exists but is not a teacher
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

export const teacherLogin = async (req: Request, res: Response): Promise<void> => {
  try {
    const { password } = req.body ?? {};
    const identifier = normalizeIdentifier(req.body?.identifier);

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

    // ── Fetch user + embedded tution branding in one round-trip ──────────────
    let query = supabase
      .from('users')
      .select(
        `
          id, tution_id, name, username, email, password_hash, profile_photo,
          role, email_verified, created_at, updated_at,
          tutions:tution_id ( id, name, slug, logo_url )
        `
      );

    query = isEmail
      ? query.eq('email', identifier)
      : query.eq('username', identifier);

    const { data: user, error: fetchErr } = await query.maybeSingle<
      User & {
        tutions: { id: string; name: string; slug: string; logo_url: string | null } | null;
      }
    >();

    if (fetchErr) {
      console.error('teacherLogin: user fetch failed:', fetchErr);
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
    if (user.role !== 'teacher') {
      res.status(403).json({ msg: 'This account is not registered as a teacher' });
      return;
    }

    // ── Sign JWT ─────────────────────────────────────────────────────────────
    const token = signToken(user);

    const { password_hash: _omit, tutions: tutionEmbed, ...safeUser } = user;
    const userResponse: UserResponse = safeUser as UserResponse;

    console.log('[teacherLogin] tution embed:', tutionEmbed);

    res.status(200).json({
      token,
      user: userResponse,
      // Flat fields - mirror tution_id.
      tution_id: user.tution_id,
      tution_name: tutionEmbed?.name ?? null,
      tution_slug: tutionEmbed?.slug ?? null,
      logo_url: tutionEmbed?.logo_url ?? null,
      // Nested form too.
      tution: tutionEmbed ?? null
    });
  } catch (err) {
    console.error('teacherLogin error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};
