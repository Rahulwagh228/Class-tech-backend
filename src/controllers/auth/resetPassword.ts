import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../../config/connectpsql.js';
import { env } from '../../config/env.js';
import type { UserRole } from '../../models/User.model.js';
import { resetSigningKey } from './forgotPassword.js';

const ALLOWED_ROLES: ReadonlyArray<UserRole> = ['student', 'teacher', 'parent'];

interface ResetJwtPayload {
  sub: string;
  role: UserRole;
  purpose: 'pwd_reset';
  iat: number;
  exp: number;
}

// =============================================================================
// POST /api/v1/auth/reset-password
//   Public. Consumes a stateless reset JWT issued by /forgot-password
//   and rotates the user's password.
//
//   Verification steps:
//     1. Decode the JWT (no signature check yet) to read `sub` (user id) and `role`.
//     2. Load the user's current password_hash from the DB.
//     3. Verify the JWT signature against (JWT_SECRET + user.password_hash).
//        - Wrong token           -> fails signature check
//        - Expired token         -> jwt throws TokenExpiredError
//        - Password already rotated -> signature no longer matches -> auto-invalidated
//     4. Bcrypt the new password and UPDATE the user row.
//
// Body:
//   { token: string, role: 'student' | 'teacher' | 'parent', new_password: string }
//
// Response 200:
//   { msg: 'Password updated. You can log in with your new password.' }
//
// Errors:
//   400 — missing fields / weak password / bad role
//   401 — token invalid / expired / superseded by a prior reset
//   500 — server error
// =============================================================================
export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    const new_password =
      typeof req.body?.new_password === 'string' ? req.body.new_password : '';
    const roleRaw =
      typeof req.body?.role === 'string' ? req.body.role.trim().toLowerCase() : '';

    if (!token) {
      res.status(400).json({ msg: 'token is required' });
      return;
    }
    if (!new_password) {
      res.status(400).json({ msg: 'new_password is required' });
      return;
    }
    if (new_password.length < 8) {
      res.status(400).json({ msg: 'new_password must be at least 8 characters' });
      return;
    }
    if (!roleRaw) {
      res.status(400).json({ msg: 'role is required' });
      return;
    }
    if (!ALLOWED_ROLES.includes(roleRaw as UserRole)) {
      res.status(400).json({ msg: `role must be one of: ${ALLOWED_ROLES.join(', ')}` });
      return;
    }
    const role = roleRaw as UserRole;

    if (!env.JWT_SECRET) {
      res.status(500).json({ msg: 'Server misconfigured: JWT_SECRET is not set' });
      return;
    }

    // Peek at payload (no signature verification) to fetch the target user.
    const decoded = jwt.decode(token);
    if (!decoded || typeof decoded !== 'object') {
      res.status(401).json({ msg: 'Invalid reset token' });
      return;
    }
    const sub = typeof (decoded as { sub?: unknown }).sub === 'string'
      ? (decoded as { sub: string }).sub
      : '';
    const payloadPurpose = (decoded as { purpose?: unknown }).purpose;
    const payloadRole = (decoded as { role?: unknown }).role;
    if (!sub || payloadPurpose !== 'pwd_reset') {
      res.status(401).json({ msg: 'Invalid reset token' });
      return;
    }
    if (payloadRole !== role) {
      res.status(401).json({ msg: 'Invalid reset token for this role' });
      return;
    }

    const userResult = await pool.query<{
      id: string;
      role: UserRole;
      password_hash: string;
    }>(
      `SELECT id, role, password_hash FROM users WHERE id = $1`,
      [sub]
    );
    const user = userResult.rows[0];
    if (!user || user.role !== role) {
      res.status(401).json({ msg: 'Invalid reset token' });
      return;
    }

    // Now verify the signature with the salted key. If the password_hash has
    // changed since the token was issued (either a prior reset succeeded or
    // the user rotated their password), verification fails here.
    let verified: ResetJwtPayload;
    try {
      verified = jwt.verify(token, resetSigningKey(user.password_hash)) as ResetJwtPayload;
    } catch (err) {
      if (err && typeof err === 'object' && (err as { name?: string }).name === 'TokenExpiredError') {
        res.status(401).json({ msg: 'This reset link has expired. Please request a new one.' });
        return;
      }
      res.status(401).json({ msg: 'This reset link is no longer valid' });
      return;
    }

    if (verified.purpose !== 'pwd_reset' || verified.sub !== user.id || verified.role !== role) {
      res.status(401).json({ msg: 'Invalid reset token' });
      return;
    }

    const new_password_hash = await bcrypt.hash(new_password, env.BCRYPT_ROUNDS);

    const update = await pool.query(
      `UPDATE users
          SET password_hash = $1,
              updated_at = NOW()
        WHERE id = $2`,
      [new_password_hash, user.id]
    );
    if (update.rowCount === 0) {
      res.status(500).json({ msg: 'Failed to update password' });
      return;
    }

    res.status(200).json({ msg: 'Password updated. You can log in with your new password.' });
  } catch (err) {
    console.error('resetPassword error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};
