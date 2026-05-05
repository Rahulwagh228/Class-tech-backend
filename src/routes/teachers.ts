import { Router } from 'express';
import { checkTeacherUsername, createTeacher } from '../controllers/teachers/create.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const teachersRouter = Router();

// ── Protected (admin only) ───────────────────────────────────────────────────

// POST /api/v1/teachers/check-username — validate availability for the form
teachersRouter.post(
  '/check-username',
  requireAuth,
  requireRole('admin'),
  checkTeacherUsername
);

// POST /api/v1/teachers/create — add a single teacher
teachersRouter.post('/create', requireAuth, requireRole('admin'), createTeacher);
