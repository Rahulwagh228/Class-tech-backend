import { Router } from 'express';
import {
  loginAsAdmin,
  me,
  sendEmailOtp,
  verifyEmailOtp
} from '../controllers/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { register } from '../controllers/auth.js';

export const authRouter = Router();

// ── Public ──────────────────────────────────────────────────────────────────
// Admin portal login (admins don't have their own router yet)
authRouter.post('/admin/login', loginAsAdmin);
authRouter.post('/admin/register', register);


// Email verification
authRouter.post('/send-otp', sendEmailOtp);
authRouter.post('/verify-otp', verifyEmailOtp);

// ── Protected ───────────────────────────────────────────────────────────────
// Returns the current user (and their role-specific profile, if any)
authRouter.get('/me', requireAuth, me);
