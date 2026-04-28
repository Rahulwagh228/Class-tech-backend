import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import crypto from 'node:crypto';
import { Resend } from 'resend';
import pool from '../config/connectpsql.js';
import { env } from '../config/env.js';
import type { JwtPayload, User, UserResponse, UserRole } from '../models/User.model.js';

const ALLOWED_ROLES: UserRole[] = ['admin', 'teacher', 'student', 'parent'];
const resend = new Resend(env.RESEND_API_KEY);

function signToken(user: Pick<User, 'id' | 'tution_id' | 'role'>): string {
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
    const { tution_id, name, username, email, password, role, profile_photo } = req.body ?? {};

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

    // email is globally unique; username is unique per tution
    const existing = await pool.query<Pick<User, 'email' | 'username' | 'tution_id'>>(
      `SELECT email, username, tution_id
       FROM users
       WHERE email = $1
          OR (tution_id = $2 AND username = $3)`,
      [email, tution_id, username]
    );
    if (existing.rows.length > 0) {
      const c = existing.rows[0];
      res
        .status(409)
        .json({ msg: c.email === email ? 'Email already exists' : 'Username already exists in this tution' });
      return;
    }

    const password_hash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);

    const result = await pool.query<UserResponse>(
      `INSERT INTO users
         (tution_id, name, username, email, password_hash, profile_photo, role, email_verified, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, NOW(), NOW())
       RETURNING id, tution_id, name, username, email, profile_photo, role, email_verified, created_at, updated_at`,
      [tution_id, name, username, email, password_hash, profile_photo ?? null, role]
    );

    const user = result.rows[0];
    const token = signToken(user);

    res.status(201).json({ token, user });
  } catch (err) {
    console.error('register error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};

// =============================================================================
// POST /api/v1/auth/login
// body: { email, password }    (email is globally unique - no tution needed)
// =============================================================================
export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body ?? {};

    if (!email || !password) {
      res.status(400).json({ msg: 'email and password are required' });
      return;
    }

    const result = await pool.query<User>(
      `SELECT id, tution_id, name, username, email, password_hash,
              profile_photo, role, email_verified, created_at, updated_at
       FROM users
       WHERE email = $1`,
      [email]
    );
    const user = result.rows[0];
    if (!user) {
      res.status(401).json({ msg: 'Invalid credentials' });
      return;
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      res.status(401).json({ msg: 'Invalid credentials' });
      return;
    }

    const { password_hash: _omit, ...safe } = user;
    const token = signToken(user);

    res.json({ token, user: safe });
  } catch (err) {
    console.error('login error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};

// =============================================================================
// POST /api/v1/auth/send-otp     body: { email }
// =============================================================================
export const sendEmailOtp = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body ?? {};
    if (!email) {
      res.status(400).json({ msg: 'email is required' });
      return;
    }

    const otp = crypto.randomInt(100_000, 999_999).toString();

    await pool.query('DELETE FROM email_otps WHERE email = $1', [email]);
    await pool.query(
      `INSERT INTO email_otps (email, otp, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '10 minutes')`,
      [email, otp]
    );

    const { error } = await resend.emails.send({
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

    if (error) {
      console.error('Resend error:', error);
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
    const { email, otp } = req.body ?? {};
    if (!email || !otp) {
      res.status(400).json({ msg: 'email and otp are required' });
      return;
    }

    const result = await pool.query(
      `SELECT id, otp, expires_at
       FROM email_otps
       WHERE email = $1 AND is_verified = FALSE
       ORDER BY created_at DESC
       LIMIT 1`,
      [email]
    );
    if (result.rows.length === 0) {
      res.status(400).json({ msg: 'OTP not found. Please request a new one.' });
      return;
    }

    const record = result.rows[0];
    if (new Date() > new Date(record.expires_at)) {
      await pool.query('DELETE FROM email_otps WHERE email = $1', [email]);
      res.status(400).json({ msg: 'OTP has expired. Please request a new one.' });
      return;
    }
    if (record.otp !== otp) {
      res.status(400).json({ msg: 'Invalid OTP' });
      return;
    }

    await pool.query('UPDATE email_otps SET is_verified = TRUE WHERE id = $1', [record.id]);
    await pool.query('UPDATE users SET email_verified = TRUE WHERE email = $1', [email]);

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
    const result = await pool.query<UserResponse>(
      `SELECT id, tution_id, name, username, email, profile_photo, role,
              email_verified, created_at, updated_at
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ msg: 'User not found' });
      return;
    }
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('me error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};
