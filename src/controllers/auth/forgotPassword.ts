import type { Request, Response } from 'express';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { Resend } from 'resend';
import pool from '../../config/connectpsql.js';
import { env } from '../../config/env.js';
import type { UserRole } from '../../models/User.model.js';

const resend = new Resend(env.RESEND_API_KEY);

// Only these three roles can use the self-service reset flow. Admin and
// superadmin accounts are managed out-of-band on purpose.
const ALLOWED_ROLES: ReadonlyArray<UserRole> = ['student', 'teacher', 'parent'];

// How long a reset link stays valid.
const TOKEN_TTL_MINUTES = 30;

function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

// Sign the reset JWT with (JWT_SECRET + user.password_hash). Once the user's
// password changes, password_hash changes too — so any outstanding reset
// token becomes unverifiable. That gives us single-use, replay-resistance,
// and auto-invalidation of older links, with zero DB state.
export function resetSigningKey(passwordHash: string): string {
  return `${env.JWT_SECRET}::pwd_reset::${passwordHash}`;
}

// Copy tailored to each role so the message feels personal, not templated.
function buildRoleCopy(role: UserRole): { audience: string; intro: string } {
  switch (role) {
    case 'student':
      return {
        audience: 'Student',
        intro:
          "It looks like you're trying to get back into your student account. " +
          'No worries — use the secure link below to set a new password and pick up right where you left off.'
      };
    case 'teacher':
      return {
        audience: 'Teacher',
        intro:
          'We received a request to reset the password on your teacher account. ' +
          'Use the secure link below to choose a new one and continue guiding your classes without a hitch.'
      };
    case 'parent':
      return {
        audience: 'Parent',
        intro:
          "We received a request to reset the password on your parent account. " +
          "Use the secure link below to set a new one and continue keeping an eye on your child's progress."
      };
    default:
      return {
        audience: 'Member',
        intro:
          'We received a request to reset the password on your Classsly account. ' +
          'Use the secure link below to set a new password.'
      };
  }
}

function buildEmail(params: {
  role: UserRole;
  name: string;
  resetUrl: string;
}): { subject: string; html: string; text: string } {
  const { role, name, resetUrl } = params;
  const { audience, intro } = buildRoleCopy(role);
  const firstName = name.split(/\s+/)[0] || name;

  const subject = `Reset your Classsly ${audience.toLowerCase()} password`;

  const html = `
  <div style="background:#f5f7fb;padding:32px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#1f2937;">
    <div style="max-width:540px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 4px 18px rgba(15,23,42,0.06);">
      <div style="background:linear-gradient(135deg,#2563eb 0%,#4f46e5 100%);padding:28px 32px;color:#fff;">
        <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;opacity:0.85;">Classsly · ${audience} account</div>
        <div style="font-size:22px;font-weight:600;margin-top:6px;">Password reset request</div>
      </div>

      <div style="padding:32px;">
        <p style="font-size:16px;margin:0 0 16px;">Hi ${firstName},</p>
        <p style="font-size:15px;line-height:1.6;margin:0 0 20px;color:#374151;">${intro}</p>

        <div style="text-align:center;margin:28px 0;">
          <a href="${resetUrl}"
             style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;
                    padding:14px 28px;border-radius:10px;font-weight:600;font-size:15px;
                    box-shadow:0 6px 16px rgba(37,99,235,0.25);">
            Reset my password
          </a>
        </div>

        <p style="font-size:13px;color:#6b7280;line-height:1.6;margin:0 0 8px;">
          This link is valid for the next <strong>${TOKEN_TTL_MINUTES} minutes</strong>
          and can be used only once.
        </p>
        <p style="font-size:13px;color:#6b7280;line-height:1.6;margin:0 0 20px;">
          If you didn't ask to reset your password, you can safely ignore this
          email — your account stays exactly as it is.
        </p>

        <div style="border-top:1px solid #e5e7eb;padding-top:16px;margin-top:24px;">
          <p style="font-size:12px;color:#9ca3af;line-height:1.6;margin:0 0 6px;">
            If the button doesn't work, copy and paste this link into your browser:
          </p>
          <p style="font-size:12px;color:#4b5563;word-break:break-all;margin:0;">
            <a href="${resetUrl}" style="color:#2563eb;text-decoration:none;">${resetUrl}</a>
          </p>
        </div>
      </div>

      <div style="background:#f9fafb;padding:18px 32px;text-align:center;font-size:12px;color:#9ca3af;">
        Sent with care from the Classsly team
      </div>
    </div>
  </div>`.trim();

  const text =
    `Hi ${firstName},\n\n` +
    `${intro}\n\n` +
    `Reset your password: ${resetUrl}\n\n` +
    `This link is valid for the next ${TOKEN_TTL_MINUTES} minutes and can be used only once. ` +
    `If you didn't request this, you can safely ignore this email.\n\n` +
    `— The Classsly team`;

  return { subject, html, text };
}

// =============================================================================
// POST /api/v1/auth/forgot-password
//   Public. Sends a password-reset email to a student / teacher / parent
//   IF an account with that email + role exists. Superadmins and admins
//   are not eligible for the self-serve flow.
//
// The link carries a stateless JWT signed with (JWT_SECRET + user.password_hash),
// so the moment the password is changed, every outstanding reset link for that
// user becomes unverifiable. No DB table needed.
//
// Body:
//   { email: string, role: 'student' | 'teacher' | 'parent' }
//
// Response 200:
//   { msg: 'Reset link sent to your registered email' }
//
// Errors:
//   400 — missing fields / invalid role / missing server config
//   404 — no account matches this email + role
//   502 — email provider failed
//   500 — server error
// =============================================================================
export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const email = normalizeEmail(req.body?.email);
    const roleRaw = typeof req.body?.role === 'string' ? req.body.role.trim().toLowerCase() : '';

    if (!email) {
      res.status(400).json({ msg: 'email is required' });
      return;
    }
    if (!roleRaw) {
      res.status(400).json({ msg: 'role is required' });
      return;
    }
    if (!ALLOWED_ROLES.includes(roleRaw as UserRole)) {
      res.status(400).json({
        msg: `role must be one of: ${ALLOWED_ROLES.join(', ')}`
      });
      return;
    }
    const role = roleRaw as UserRole;

    if (!env.JWT_SECRET) {
      res.status(500).json({ msg: 'Server misconfigured: JWT_SECRET is not set' });
      return;
    }
    if (!env.RESEND_API_KEY) {
      res.status(500).json({ msg: 'Server misconfigured: RESEND_API_KEY is not set' });
      return;
    }
    if (!env.EMAIL_FROM) {
      res.status(500).json({ msg: 'Server misconfigured: EMAIL_FROM is not set' });
      return;
    }

    // Look up user by email + role. We *do* leak existence here because the
    // requirement is that only the person whose email is registered can trigger
    // this flow, and the caller needs a clear "no account" signal on the UI.
    const userResult = await pool.query<{
      id: string;
      name: string;
      email: string;
      role: UserRole;
      password_hash: string;
    }>(
      `SELECT id, name, email, role, password_hash
         FROM users
        WHERE LOWER(email) = $1 AND role = $2
        LIMIT 1`,
      [email, role]
    );
    const user = userResult.rows[0];
    if (!user) {
      res.status(404).json({ msg: 'No account found for this email and role' });
      return;
    }

    const token = jwt.sign(
      { sub: user.id, role, purpose: 'pwd_reset' },
      resetSigningKey(user.password_hash),
      { expiresIn: `${TOKEN_TTL_MINUTES}m` } satisfies SignOptions
    );

    const resetUrl =
      `${env.APP_URL.replace(/\/+$/, '')}/reset-password` +
      `?token=${encodeURIComponent(token)}` +
      `&role=${encodeURIComponent(role)}`;

    const { subject, html, text } = buildEmail({
      role,
      name: user.name,
      resetUrl
    });

    const { error: mailErr } = await resend.emails.send({
      from: env.EMAIL_FROM,
      to: [user.email],
      subject,
      html,
      text
    });

    if (mailErr) {
      console.error('forgotPassword: Resend error:', mailErr);
      res.status(502).json({ msg: 'Failed to send reset email' });
      return;
    }

    res.status(200).json({ msg: 'Reset link sent to your registered email' });
  } catch (err) {
    console.error('forgotPassword error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};
