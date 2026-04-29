import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import crypto from 'node:crypto';
import { Resend } from 'resend';
// Local Postgres client - kept for localhost testing. Uncomment imports below
// AND swap each Supabase call back to its commented `pool.query` equivalent.
// import pool from '../config/connectpsql.js';
import supabase from '../config/connectSupabase.js';
import { env } from '../config/env.js';
import type { JwtPayload, User, UserResponse, UserRole } from '../models/User.model.js';

const ALLOWED_ROLES: UserRole[] = ['admin', 'teacher', 'student', 'parent'];
const resend = new Resend(env.RESEND_API_KEY);

// Normalize emails so casing / whitespace can't cause "user not found" mismatches.
// e.g. "  Admin@Example.COM " -> "admin@example.com"
function normalizeEmail(value: unknown): string {
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

// =============================================================================
// POST /api/v1/auth/register
// body: { tution_id, name, username, email, password, role, profile_photo? }
// =============================================================================
export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { tution_id, name, username, password, role, profile_photo } = req.body ?? {};
    const email = normalizeEmail(req.body?.email);
    console.log('register api hitt with role:', role);

    if (!tution_id || !name || !username || !email || !password || !role) {
      res
        .status(400)
        .json({ msg: 'tution_id, name, username, email, password and role are required' });
      return;
    }
    if (!ALLOWED_ROLES.includes(role)) {
      res.status(400).json({ msg: `role must be one of: ${ALLOWED_ROLES.join(', ')}` });
      return;
    }
    if (typeof password !== 'string' || password.length < 8) {
      res.status(400).json({ msg: 'password must be at least 8 characters' });
      return;
    }

    // -------------------------------------------------------------------------
    // Uniqueness check: email is global, (tution_id, username) is per-tution
    // -------------------------------------------------------------------------
    // [pg version]
    // const existing = await pool.query<Pick<User, 'email' | 'username' | 'tution_id'>>(
    //   `SELECT email, username, tution_id
    //    FROM users
    //    WHERE email = $1
    //       OR (tution_id = $2 AND username = $3)`,
    //   [email, tution_id, username]
    // );
    // const conflictRow = existing.rows[0];

    const { data: existingRows, error: existingErr } = await supabase
      .from('users')
      .select('email, username, tution_id')
      .or(`email.eq.${email},and(tution_id.eq.${tution_id},username.eq.${username})`)
      .limit(1);

    if (existingErr) {
      console.error('supabase existing-user check failed:', existingErr);
      res.status(500).json({ msg: 'Server error' });
      return;
    }
    const conflictRow = existingRows?.[0];

    if (conflictRow) {
      res.status(409).json({
        msg:
          conflictRow.email === email
            ? 'Email already exists'
            : 'Username already exists in this tution'
      });
      return;
    }

    const password_hash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);

    // -------------------------------------------------------------------------
    // Insert user
    // -------------------------------------------------------------------------
    // [pg version]
    // const result = await pool.query<UserResponse>(
    //   `INSERT INTO users
    //      (tution_id, name, username, email, password_hash, profile_photo, role, email_verified, created_at, updated_at)
    //    VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, NOW(), NOW())
    //    RETURNING id, tution_id, name, username, email, profile_photo, role, email_verified, created_at, updated_at`,
    //   [tution_id, name, username, email, password_hash, profile_photo ?? null, role]
    // );
    // const user = result.rows[0];

    const { data: user, error: insertErr } = await supabase
      .from('users')
      .insert({
        tution_id,
        name,
        username,
        email,
        password_hash,
        profile_photo: profile_photo ?? null,
        role,
        email_verified: false
      })
      .select(
        'id, tution_id, name, username, email, profile_photo, role, email_verified, created_at, updated_at'
      )
      .single<UserResponse>();

    if (insertErr || !user) {
      console.error('supabase insert user failed:', insertErr);
      res.status(500).json({ msg: 'Server error' });
      return;
    }

    const token = signToken(user);
    res.status(201).json({ token, user });
  } catch (err) {
    console.error('register error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};

// =============================================================================
// Internal: shared login flow.
// =============================================================================
async function performLogin(
  req: Request,
  res: Response,
  expectedRole: UserRole | null
): Promise<void> {
  try {
    const { password } = req.body ?? {};
    const email = normalizeEmail(req.body?.email);
    const bodyRole: unknown = req.body?.role;

    if (!email || !password) {
      res.status(400).json({ msg: 'email and password are required' });
      return;
    }

    const requiredRole: UserRole | null =
      expectedRole ?? (typeof bodyRole === 'string' ? (bodyRole as UserRole) : null);

    if (!requiredRole) {
      res.status(400).json({ msg: 'role is required' });
      return;
    }
    if (!ALLOWED_ROLES.includes(requiredRole)) {
      res.status(400).json({ msg: `role must be one of: ${ALLOWED_ROLES.join(', ')}` });
      return;
    }

    // -------------------------------------------------------------------------
    // Fetch user by email
    // -------------------------------------------------------------------------
    // [pg version]
    // const result = await pool.query<User>(
    //   `SELECT id, tution_id, name, username, email, password_hash,
    //           profile_photo, role, email_verified, created_at
    //    FROM users
    //    WHERE email = $1`,
    //   [email]
    // );
    // const user = result.rows[0];

    const { data: user, error: fetchErr } = await supabase
      .from('users')
      .select(
        'id, tution_id, name, username, email, password_hash, profile_photo, role, email_verified, created_at, updated_at'
      )
      .eq('email', email)
      .maybeSingle<User>();

    if (fetchErr) {
      console.error('supabase fetch user failed:', fetchErr);
      res.status(500).json({ msg: 'Server error' });
      return;
    }
    if (!user) {
      res.status(401).json({ msg: 'user not found' });
      return;
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      res.status(401).json({ msg: 'Invalid credentials' });
      return;
    }

    if (user.role !== requiredRole) {
      res.status(403).json({ msg: `This account is not registered as ${requiredRole}` });
      return;
    }

    const { password_hash: _omit, ...safe } = user;
    const token = signToken(user);

    res.json({ token, user: safe });
  } catch (err) {
    console.error('login error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
}

export const login = (req: Request, res: Response) => performLogin(req, res, null);
export const loginAsAdmin = (req: Request, res: Response) => performLogin(req, res, 'admin');
export const loginAsTeacher = (req: Request, res: Response) => performLogin(req, res, 'teacher');
export const loginAsStudent = (req: Request, res: Response) => performLogin(req, res, 'student');
export const loginAsParent = (req: Request, res: Response) => performLogin(req, res, 'parent');

// =============================================================================
// POST /api/v1/auth/send-otp     body: { email }
// =============================================================================
export const sendEmailOtp = async (req: Request, res: Response): Promise<void> => {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!email) {
      res.status(400).json({ msg: 'email is required' });
      return;
    }

    const otp = crypto.randomInt(100_000, 999_999).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // -------------------------------------------------------------------------
    // Replace any existing OTP for this email, then insert the new one
    // -------------------------------------------------------------------------
    // [pg version]
    // await pool.query('DELETE FROM email_otps WHERE email = $1', [email]);
    // await pool.query(
    //   `INSERT INTO email_otps (email, otp, expires_at)
    //    VALUES ($1, $2, NOW() + INTERVAL '10 minutes')`,
    //   [email, otp]
    // );

    const { error: deleteErr } = await supabase.from('email_otps').delete().eq('email', email);
    if (deleteErr) {
      console.error('supabase delete old OTP failed:', deleteErr);
    }

    const { error: insertErr } = await supabase
      .from('email_otps')
      .insert({ email, otp, expires_at: expiresAt });
    if (insertErr) {
      console.error('supabase insert OTP failed:', insertErr);
      res.status(500).json({ msg: 'Failed to store OTP' });
      return;
    }

    if (!env.EMAIL_FROM) {
      res.status(500).json({ msg: 'Server misconfigured: EMAIL_FROM is not set' });
      return;
    }
    const { error: mailErr } = await resend.emails.send({
      from: env.EMAIL_FROM,
      to: [email],
      subject: 'Your Class Tech verification code',
      html: `
        <div style="font-family: sans-serif; max-width: 420px; margin: 0 auto;">
          <h2>Verify your email</h2>
          <p>Your one-time code is:</p>
          <h1 style="letter-spacing: 8px; color: #2563eb;">${otp}</h1>
          <p style="color: #888;">Expires in 10 minutes. Do not share with anyone.</p>
        </div>`,
      text: `Your Class Tech OTP is: ${otp}. Expires in 10 minutes.`
    });

    if (mailErr) {
      console.error('Resend error:', mailErr);
      res.status(502).json({ msg: 'Failed to send OTP email' });
      return;
    }

    res.status(200).json({ msg: 'OTP sent successfully' });
  } catch (err) {
    console.error('sendEmailOtp error:', err);
    res.status(500).json({ msg: 'Internal server error' });
  }
};

// =============================================================================
// POST /api/v1/auth/verify-otp   body: { email, otp }
// =============================================================================
export const verifyEmailOtp = async (req: Request, res: Response): Promise<void> => {
  try {
    const email = normalizeEmail(req.body?.email);
    const { otp } = req.body ?? {};
    if (!email || !otp) {
      res.status(400).json({ msg: 'email and otp are required' });
      return;
    }

    // -------------------------------------------------------------------------
    // Fetch the latest unverified OTP for this email
    // -------------------------------------------------------------------------
    // [pg version]
    // const result = await pool.query(
    //   `SELECT id, otp, expires_at
    //    FROM email_otps
    //    WHERE email = $1 AND is_verified = FALSE
    //    ORDER BY created_at DESC
    //    LIMIT 1`,
    //   [email]
    // );
    // const record = result.rows[0];

    const { data: record, error: fetchErr } = await supabase
      .from('email_otps')
      .select('id, otp, expires_at')
      .eq('email', email)
      .eq('is_verified', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fetchErr) {
      console.error('supabase fetch OTP failed:', fetchErr);
      res.status(500).json({ msg: 'Server error' });
      return;
    }
    if (!record) {
      res.status(400).json({ msg: 'OTP not found. Please request a new one.' });
      return;
    }

    if (new Date() > new Date(record.expires_at)) {
      // [pg version]
      // await pool.query('DELETE FROM email_otps WHERE email = $1', [email]);
      await supabase.from('email_otps').delete().eq('email', email);
      res.status(400).json({ msg: 'OTP has expired. Please request a new one.' });
      return;
    }
    if (record.otp !== otp) {
      res.status(400).json({ msg: 'Invalid OTP' });
      return;
    }

    // -------------------------------------------------------------------------
    // Mark OTP verified + flip user.email_verified
    // -------------------------------------------------------------------------
    // [pg version]
    // await pool.query('UPDATE email_otps SET is_verified = TRUE WHERE id = $1', [record.id]);
    // await pool.query('UPDATE users SET email_verified = TRUE WHERE email = $1', [email]);

    const { error: otpUpdateErr } = await supabase
      .from('email_otps')
      .update({ is_verified: true })
      .eq('id', record.id);
    if (otpUpdateErr) {
      console.error('supabase update OTP failed:', otpUpdateErr);
      res.status(500).json({ msg: 'Server error' });
      return;
    }

    const { error: userUpdateErr } = await supabase
      .from('users')
      .update({ email_verified: true })
      .eq('email', email);
    if (userUpdateErr) {
      console.error('supabase update user failed:', userUpdateErr);
      res.status(500).json({ msg: 'Server error' });
      return;
    }

    res.status(200).json({ msg: 'Email verified successfully' });
  } catch (err) {
    console.error('verifyEmailOtp error:', err);
    res.status(500).json({ msg: 'Internal server error' });
  }
};

// =============================================================================
// GET /api/v1/auth/me  (protected)
// =============================================================================
export const me = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ msg: 'Authentication required' });
      return;
    }

    // -------------------------------------------------------------------------
    // [pg version]
    // const result = await pool.query<UserResponse>(
    //   `SELECT id, tution_id, name, username, email, profile_photo, role,
    //           email_verified, created_at, updated_at
    //    FROM users WHERE id = $1`,
    //   [req.user.id]
    // );
    // const user = result.rows[0];

    const { data: user, error } = await supabase
      .from('users')
      .select(
        'id, tution_id, name, username, email, profile_photo, role, email_verified, created_at, updated_at'
      )
      .eq('id', req.user.id)
      .maybeSingle<UserResponse>();

    if (error) {
      console.error('supabase me fetch failed:', error);
      res.status(500).json({ msg: 'Server error' });
      return;
    }
    if (!user) {
      res.status(404).json({ msg: 'User not found' });
      return;
    }
    res.json({ user });
  } catch (err) {
    console.error('me error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};
