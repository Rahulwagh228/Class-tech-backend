import { Router } from 'express';
import { checkTeacherUsername, createTeacher } from '../controllers/teachers/create.js';
import { listTeachers } from '../controllers/teachers/list.js';
import { teacherDetails } from '../controllers/teachers/details.js';
import { teacherLogin } from '../controllers/teachers/auth.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const teachersRouter = Router();

// ── Public ───────────────────────────────────────────────────────────────────
// POST /api/v1/teachers/auth/login
// Body: { identifier: string (email or username), password: string }
teachersRouter.post('/auth/login', teacherLogin);

// ── Protected ────────────────────────────────────────────────────────────────

// GET /api/v1/teachers — list teachers in the caller's tution
teachersRouter.get('/', requireAuth, requireRole('admin', 'teacher'), listTeachers);

// POST /api/v1/teachers/check-username — validate availability for the form
teachersRouter.post(
  '/check-username',
  requireAuth,
  requireRole('admin'),
  checkTeacherUsername
);

// POST /api/v1/teachers/create — add a single teacher (admin only)
teachersRouter.post('/create', requireAuth, requireRole('admin'), createTeacher);

// GET /api/v1/teachers/:teacherId — full profile (users + teachers joined)
teachersRouter.get(
  '/:teacherId',
  requireAuth,
  requireRole('admin', 'teacher'),
  teacherDetails
);
