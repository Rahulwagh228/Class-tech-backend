import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import pool from '../../config/connectpsql.js';
import { env } from '../../config/env.js';
import type {
  SuperadminAccount,
  SuperadminJwtPayload,
  SuperadminLoginResponse
} from '../../models/Superadmin.model.js';

const DEFAULT_SUPERADMIN_EMAIL = 'Rahul@classsly.in';
const DEFAULT_SUPERADMIN_PASSWORD = 'Kobu@99';

function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function signToken(superadmin: Pick<SuperadminAccount, 'id'>): string {
  if (!env.JWT_SECRET) {
    throw new Error('JWT_SECRET is not set in environment');
  }

  const payload: SuperadminJwtPayload = {
    id: superadmin.id,
    role: 'superadmin'
  };

  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn']
  });
}

async function ensureDefaultSuperadminAccount(): Promise<void> {
  const passwordHash = await bcrypt.hash(DEFAULT_SUPERADMIN_PASSWORD, env.BCRYPT_ROUNDS);

  await pool.query(
    `INSERT INTO superadmins (email, password_hash)
     VALUES ($1, $2)
     ON CONFLICT (email) DO NOTHING`,
    [DEFAULT_SUPERADMIN_EMAIL, passwordHash]
  );
}

export const loginSuperadmin = async (req: Request, res: Response): Promise<void> => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!email || !password) {
      res.status(400).json({ msg: 'email and password are required' });
      return;
    }

    await ensureDefaultSuperadminAccount();

    const result = await pool.query<SuperadminAccount>(
      `SELECT id, email, password_hash, created_at, updated_at
         FROM superadmins
        WHERE email = $1`,
      [email]
    );
    const superadmin = result.rows[0];

    if (!superadmin) {
      res.status(401).json({ msg: 'Invalid credentials' });
      return;
    }

    const passwordMatch = await bcrypt.compare(password, superadmin.password_hash);
    if (!passwordMatch) {
      res.status(401).json({ msg: 'Invalid credentials' });
      return;
    }

    const token = signToken(superadmin);
    const response: SuperadminLoginResponse = {
      token,
      superadmin: {
        id: superadmin.id,
        email: superadmin.email,
        created_at: superadmin.created_at,
        updated_at: superadmin.updated_at,
        role: 'superadmin'
      }
    };

    res.status(200).json(response);
  } catch (err) {
    console.error('superadmin login error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};