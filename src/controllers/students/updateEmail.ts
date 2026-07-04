import type { Request, Response } from 'express';
import pool from '../../config/connectpsql.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

// =============================================================================
// PATCH /api/v1/student/me/email     (auth required, role=student)
//
// Verifies the OTP sent to the student's *new* email address (via the existing
// POST /api/v1/auth/send-otp endpoint), and — on success — flips
//   users.email          -> new_email
//   users.email_verified -> TRUE
// for the user identified by the JWT.
//
// The account is located by req.user.id (NOT by the old email in the body),
// so the caller can never touch anyone else's row.
//
// Body:
//   { new_email: string, otp: string }
//
// Response 200:
//   {
//     msg: 'Email updated and verified',
//     user: { id, email, email_verified }
//   }
//
// Errors:
//   400 — bad body (missing/invalid new_email/otp, OTP expired, wrong OTP)
//   401 — not authenticated
//   403 — caller is not a student
//   404 — user not found
//   409 — new_email is already used by a different account
//   500 — server error
// =============================================================================
export const verifyEmailEdit = async (req: Request, res: Response): Promise<void> => {
  const client = await pool.connect();
  try {
    if (!req.user) {
      res.status(401).json({ msg: 'Authentication required' });
      return;
    }
    if (req.user.role !== 'student') {
      res.status(403).json({ msg: 'Only students can edit their email here' });
      return;
    }
    const userId = req.user.id;

    const newEmail = normalizeEmail(req.body?.new_email ?? req.body?.email);
    const otp =
      typeof req.body?.otp === 'string' ? req.body.otp.trim() : '';

    if (!newEmail || !EMAIL_REGEX.test(newEmail)) {
      res.status(400).json({ msg: 'a valid new_email is required' });
      return;
    }
    if (!otp) {
      res.status(400).json({ msg: 'otp is required' });
      return;
    }

    // -------------------------------------------------------------------------
    // Fetch the latest unverified OTP that was sent to the new address.
    // -------------------------------------------------------------------------
    const otpResult = await client.query<{
      id: string;
      otp: string;
      expires_at: string | Date;
    }>(
      `SELECT id, otp, expires_at
         FROM email_otps
        WHERE LOWER(email) = $1 AND is_verified = FALSE
        ORDER BY created_at DESC
        LIMIT 1`,
      [newEmail]
    );
    const record = otpResult.rows[0];
    if (!record) {
      res.status(400).json({
        msg: 'OTP not found for this email. Please request a new one.'
      });
      return;
    }
    if (new Date() > new Date(record.expires_at)) {
      await client.query('DELETE FROM email_otps WHERE LOWER(email) = $1', [newEmail]);
      res.status(400).json({ msg: 'OTP has expired. Please request a new one.' });
      return;
    }
    if (record.otp !== otp) {
      res.status(400).json({ msg: 'Invalid OTP' });
      return;
    }

    // -------------------------------------------------------------------------
    // Everything below runs in a transaction so we don't leave the OTP marked
    // verified while the users update silently fails (or vice-versa).
    // -------------------------------------------------------------------------
    await client.query('BEGIN');

    // Make sure the current user still exists.
    const meResult = await client.query<{ id: string; email: string }>(
      `SELECT id, email FROM users WHERE id = $1`,
      [userId]
    );
    const me = meResult.rows[0];
    if (!me) {
      await client.query('ROLLBACK');
      res.status(404).json({ msg: 'User not found' });
      return;
    }

    // If the new email already belongs to a DIFFERENT user, block.
    const clash = await client.query<{ id: string }>(
      `SELECT id
         FROM users
        WHERE LOWER(email) = $1 AND id <> $2
        LIMIT 1`,
      [newEmail, userId]
    );
    if (clash.rows[0]) {
      await client.query('ROLLBACK');
      res.status(409).json({ msg: 'This email is already used by another account' });
      return;
    }

    // Mark the OTP consumed.
    const otpUpdate = await client.query(
      `UPDATE email_otps SET is_verified = TRUE WHERE id = $1`,
      [record.id]
    );
    if (otpUpdate.rowCount === 0) {
      await client.query('ROLLBACK');
      console.error('verifyEmailEdit: email_otps UPDATE affected 0 rows', {
        id: record.id
      });
      res.status(500).json({ msg: 'Failed to mark OTP as verified' });
      return;
    }

    // Flip email + email_verified on the row selected by JWT id.
    const userUpdate = await client.query<{
      id: string;
      email: string;
      email_verified: boolean;
    }>(
      `UPDATE users
          SET email = $1,
              email_verified = TRUE,
              updated_at = NOW()
        WHERE id = $2
        RETURNING id, email, email_verified`,
      [newEmail, userId]
    );
    if (userUpdate.rowCount === 0 || !userUpdate.rows[0]) {
      await client.query('ROLLBACK');
      console.error('verifyEmailEdit: users UPDATE affected 0 rows', { userId });
      res.status(404).json({ msg: 'User not found' });
      return;
    }

    // Clean up any older, still-unverified OTPs for the same address so a
    // stale one can't be replayed.
    await client.query(
      `DELETE FROM email_otps
        WHERE LOWER(email) = $1 AND is_verified = FALSE`,
      [newEmail]
    );

    await client.query('COMMIT');

    res.status(200).json({
      msg: 'Email updated and verified',
      user: userUpdate.rows[0]
    });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore rollback error */
    }
    // Postgres unique-violation on users.email
    if ((err as { code?: string }).code === '23505') {
      res.status(409).json({ msg: 'This email is already used by another account' });
      return;
    }
    console.error('verifyEmailEdit error:', err);
    res.status(500).json({ msg: 'Server error' });
  } finally {
    client.release();
  }
};
