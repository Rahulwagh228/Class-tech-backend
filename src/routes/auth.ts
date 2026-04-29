import { Router } from 'express';
import {
  login,
  loginAsAdmin,
  loginAsParent,
  loginAsStudent,
  loginAsTeacher,
  me,
  register,
  sendEmailOtp,
  verifyEmailOtp
} from '../controllers/auth.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const authRouter = Router();

// public
authRouter.post('/register',         register);
authRouter.post('/login',            login);            // generic - role in body
authRouter.post('/admin/login',      loginAsAdmin);     // role-locked portals
authRouter.post('/teacher/login',    loginAsTeacher);
authRouter.post('/student/login',    loginAsStudent);
authRouter.post('/parent/login',     loginAsParent);
authRouter.post('/send-otp',         sendEmailOtp);
authRouter.post('/verify-otp',       verifyEmailOtp);

// protected
authRouter.get('/me', requireAuth, me);

// example role-gated route
authRouter.get('/admin/ping', requireAuth, requireRole('admin'), (_req, res) => {
  res.json({ msg: 'admin access granted' });
});
