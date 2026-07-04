import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import crypto from 'node:crypto';
import { Resend } from 'resend';
import pool from '../config/connectpsql.js';
import { env } from '../config/env.js';
import type {
  JwtPayload,
  Student,
  StudentInput,
  Teacher,
  TeacherInput,
  User,
  UserResponse,
  UserRole
} from '../models/User.model.js';

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
// body: {
//   tution_id, name, username, email, password, role, profile_photo?,
//   student?: { enrollment_number, date_of_birth?, gender?, grade_level?, ... },
//   teacher?: { employee_id, qualification?, specialization?, ... }
// }
// If role='student', the `student` object is required.
// If role='teacher', the `teacher` object is required.
// admin/parent: no extra object needed.
// =============================================================================
export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { tution_id, name, username, password, role, profile_photo } = req.body ?? {};
    const email = normalizeEmail(req.body?.email);
    const studentInput: StudentInput | undefined = req.body?.student;
    const teacherInput: TeacherInput | undefined = req.body?.teacher;
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
    if (role === 'student' && !studentInput?.enrollment_number) {
      res.status(400).json({ msg: 'student.enrollment_number is required for role=student' });
      return;
    }
    if (role === 'teacher' && !teacherInput?.employee_id) {
      res.status(400).json({ msg: 'teacher.employee_id is required for role=teacher' });
      return;
    }

    // Uniqueness check: email is global, (tution_id, username) is per-tution
    const existing = await pool.query<Pick<User, 'email' | 'username' | 'tution_id'>>(
      `SELECT email, username, tution_id
         FROM users
        WHERE email = $1
           OR (tution_id = $2 AND username = $3)
        LIMIT 1`,
      [email, tution_id, username]
    );
    const conflictRow = existing.rows[0];

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

    const insertUser = await pool.query<UserResponse>(
      `INSERT INTO users
         (tution_id, name, username, email, password_hash, profile_photo, role,
          email_verified, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, NOW(), NOW())
       RETURNING id, tution_id, name, username, email, profile_photo, role,
                 email_verified, created_at, updated_at`,
      [tution_id, name, username, email, password_hash, profile_photo ?? null, role]
    );
    const user = insertUser.rows[0];

    if (!user) {
      res.status(500).json({ msg: 'Server error' });
      return;
    }

    // Insert role-specific profile row. If this fails we delete the user row
    // we just created so we never end up with an orphaned auth account.
    let profile: Student | Teacher | null = null;

    if (role === 'student' && studentInput) {
      try {
        const studentResult = await pool.query<Student>(
          `INSERT INTO students
             (user_id, tution_id, enrollment_number, date_of_birth, gender,
              grade_level, section, blood_group, guardian_name, guardian_phone,
              emergency_contact, address, admission_date, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
           RETURNING *`,
          [
            user.id,
            tution_id,
            studentInput.enrollment_number,
            studentInput.date_of_birth ?? null,
            studentInput.gender ?? null,
            studentInput.grade_level ?? null,
            studentInput.section ?? null,
            studentInput.blood_group ?? null,
            studentInput.guardian_name ?? null,
            studentInput.guardian_phone ?? null,
            studentInput.emergency_contact ?? null,
            studentInput.address ?? null,
            studentInput.admission_date ?? null,
            studentInput.notes ?? null
          ]
        );
        profile = studentResult.rows[0] ?? null;
        if (!profile) throw new Error('student row not returned');
      } catch (err) {
        console.error('insert student failed:', err);
        await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
        res.status(500).json({ msg: 'Failed to create student profile' });
        return;
      }
    } else if (role === 'teacher' && teacherInput) {
      try {
        const teacherResult = await pool.query<Teacher>(
          `INSERT INTO teachers
             (user_id, tution_id, employee_id, date_of_birth, gender,
              qualification, specialization, experience_years, joining_date,
              bio, phone, address)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           RETURNING *`,
          [
            user.id,
            tution_id,
            teacherInput.employee_id,
            teacherInput.date_of_birth ?? null,
            teacherInput.gender ?? null,
            teacherInput.qualification ?? null,
            teacherInput.specialization ?? null,
            teacherInput.experience_years ?? null,
            teacherInput.joining_date ?? null,
            teacherInput.bio ?? null,
            teacherInput.phone ?? null,
            teacherInput.address ?? null
          ]
        );
        profile = teacherResult.rows[0] ?? null;
        if (!profile) throw new Error('teacher row not returned');
      } catch (err) {
        console.error('insert teacher failed:', err);
        await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
        res.status(500).json({ msg: 'Failed to create teacher profile' });
        return;
      }
    }

    const token = signToken(user);
    res.status(201).json({
      token,
      user,
      ...(role === 'student' && profile ? { student: profile } : {}),
      ...(role === 'teacher' && profile ? { teacher: profile } : {})
    });
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

    const result = await pool.query<User>(
      `SELECT id, tution_id, name, username, email, password_hash,
              profile_photo, role, email_verified, created_at, updated_at
         FROM users
        WHERE email = $1`,
      [email]
    );
    const user = result.rows[0];

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

    // Fetch the tution's branding (name, slug, logo_url) so the frontend can
    // render the institution's logo on every screen straight after login,
    // without a separate round trip. Failure to fetch it is non-fatal - we
    // still complete the login.
    let tutionRow: {
      id: string;
      name: string;
      slug: string;
      logo_url: string | null;
    } | null = null;
    try {
      const tutionResult = await pool.query<{
        id: string;
        name: string;
        slug: string;
        logo_url: string | null;
      }>(
        `SELECT id, name, slug, logo_url
           FROM tutions
          WHERE id = $1`,
        [user.tution_id]
      );
      tutionRow = tutionResult.rows[0] ?? null;
    } catch (err) {
      console.warn('login: tution lookup failed (continuing anyway):', err);
    }

    const { password_hash: _omit, ...safe } = user;
    const token = signToken(user);

    res.json({
      token,
      user: safe,
      tution: tutionRow
    });
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

    if (!env.RESEND_API_KEY) {
      res.status(500).json({ msg: 'Server misconfigured: RESEND_API_KEY is not set' });
      return;
    }
    if (!env.EMAIL_FROM) {
      res.status(500).json({ msg: 'Server misconfigured: EMAIL_FROM is not set' });
      return;
    }

    const otp = crypto.randomInt(100_000, 999_999).toString();

    // Replace any existing OTP for this email, then insert the new one.
    await pool.query('DELETE FROM email_otps WHERE email = $1', [email]);
    await pool.query(
      `INSERT INTO email_otps (email, otp, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '10 minutes')`,
      [email, otp]
    );

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

    const result = await pool.query<{
      id: string;
      otp: string;
      expires_at: string | Date;
    }>(
      `SELECT id, otp, expires_at
         FROM email_otps
        WHERE email = $1 AND is_verified = FALSE
        ORDER BY created_at DESC
        LIMIT 1`,
      [email]
    );
    const record = result.rows[0];

    if (!record) {
      res.status(400).json({ msg: 'OTP not found. Please request a new one.' });
      return;
    }

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
         FROM users
        WHERE id = $1`,
      [req.user.id]
    );
    const user = result.rows[0];

    if (!user) {
      res.status(404).json({ msg: 'User not found' });
      return;
    }

    let student: Student | null = null;
    let teacher: Teacher | null = null;

    if (user.role === 'student') {
      const studentResult = await pool.query<Student>(
        `SELECT * FROM students WHERE user_id = $1`,
        [user.id]
      );
      student = studentResult.rows[0] ?? null;
    } else if (user.role === 'teacher') {
      const teacherResult = await pool.query<Teacher>(
        `SELECT * FROM teachers WHERE user_id = $1`,
        [user.id]
      );
      teacher = teacherResult.rows[0] ?? null;
    }

    res.json({
      user,
      ...(student ? { student } : {}),
      ...(teacher ? { teacher } : {})
    });
  } catch (err) {
    console.error('me error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};
