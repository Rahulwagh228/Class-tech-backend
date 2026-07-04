import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../../config/connectpsql.js';
import { env } from '../../config/env.js';

// =============================================================================
// PATCH /api/v1/student/me/password   (auth required, role=student)
//
// Lets an authenticated student rotate their own password. The row to update
// is located by req.user.id (NOT by anything in the body), so a caller can
// only ever change their own password.
//
// Body:
//   {
//     old_password: string,   // required, must match the stored hash
//     new_password: string    // required, min 8 chars, must differ from old
//   }
//
// Response 200:
//   { msg: 'Password updated' }
//
// Errors:
//   400 — missing fields / new password too short / same as old
//   401 — not authenticated OR old_password is wrong
//   403 — caller is not a student
//   404 — user not found
//   500 — server error
// =============================================================================
export const updateOwnPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ msg: 'Authentication required' });
      return;
    }
    if (req.user.role !== 'student') {
      res.status(403).json({ msg: 'Only students can change their password here' });
      return;
    }
    const userId = req.user.id;

    const old_password =
      typeof req.body?.old_password === 'string' ? req.body.old_password : '';
    const new_password =
      typeof req.body?.new_password === 'string' ? req.body.new_password : '';

    if (!old_password || !new_password) {
      res.status(400).json({ msg: 'old_password and new_password are required' });
      return;
    }
    if (new_password.length < 8) {
      res.status(400).json({ msg: 'new_password must be at least 8 characters' });
      return;
    }
    if (old_password === new_password) {
      res.status(400).json({ msg: 'new_password must be different from old_password' });
      return;
    }

    // -------------------------------------------------------------------------
    // Pull the current hash for this user.
    // -------------------------------------------------------------------------
    const result = await pool.query<{ id: string; password_hash: string }>(
      `SELECT id, password_hash FROM users WHERE id = $1`,
      [userId]
    );
    const user = result.rows[0];
    if (!user) {
      res.status(404).json({ msg: 'User not found' });
      return;
    }

    const ok = await bcrypt.compare(old_password, user.password_hash);
    if (!ok) {
      // Deliberately 401 (not 400) — same shape as failed login so the client
      // can render "incorrect current password" without a special case.
      res.status(401).json({ msg: 'old_password is incorrect' });
      return;
    }

    const new_password_hash = await bcrypt.hash(new_password, env.BCRYPT_ROUNDS);

    const update = await pool.query(
      `UPDATE users
          SET password_hash = $1,
              updated_at = NOW()
        WHERE id = $2`,
      [new_password_hash, userId]
    );

    if (update.rowCount === 0) {
      console.error('updateOwnPassword: UPDATE affected 0 rows', { userId });
      res.status(500).json({ msg: 'Failed to update password' });
      return;
    }

    res.status(200).json({ msg: 'Password updated' });
  } catch (err) {
    console.error('updateOwnPassword error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};
