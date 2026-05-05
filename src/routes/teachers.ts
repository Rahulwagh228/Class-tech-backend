import { Router } from 'express';
import { checkTeacherUsername, createTeacher } from '../controllers/teachers/create.js';
import { listTeachers } from '../controllers/teachers/list.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const teachersRouter = Router();

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
