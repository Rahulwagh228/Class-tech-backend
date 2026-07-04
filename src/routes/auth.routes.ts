import { Router } from 'express';
import {
  loginAsAdmin,
  loginAsParent,
  me,
  register,
  sendEmailOtp,
  verifyEmailOtp
} from '../controllers/auth.js';
import { studentLogin } from '../controllers/students/auth.js';
import { teacherLogin } from '../controllers/teachers/auth.js';
import { requireAuth } from '../middleware/auth.js';

export const authRouter = Router();

// ── Logins (public) ─────────────────────────────────────────────────────────
authRouter.post('/admin/login', loginAsAdmin);
authRouter.post('/admin/register', register);
authRouter.post('/teacher/login', teacherLogin);
authRouter.post('/student/login', studentLogin);
authRouter.post('/parent/login', loginAsParent);

// ── Email verification (public) ─────────────────────────────────────────────
authRouter.post('/send-otp', sendEmailOtp);
authRouter.post('/verify-otp', verifyEmailOtp);

// ── Session (protected) ─────────────────────────────────────────────────────
authRouter.get('/me', requireAuth, me);
