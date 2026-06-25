import { Router } from 'express';
import { listStudents } from '../controllers/students/list.js';
import { studentDetails } from '../controllers/students/details.js';
import { studentLogin } from '../controllers/students/auth.js';
import { checkUsername, createStudent } from '../controllers/students/create.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const studentsRouter = Router();

// ── Public ───────────────────────────────────────────────────────────────────
// POST /api/v1/students/auth/login
// Body: { identifier: string (email or username), password: string }
studentsRouter.post('/auth/login', studentLogin);

// ── Protected (admin / teacher only) ─────────────────────────────────────────
studentsRouter.get('/', requireAuth, requireRole('admin', 'teacher'), listStudents);

// POST /api/v1/students/check-username — validate availability for the form
studentsRouter.post(
  '/check-username',
  requireAuth,
  requireRole('admin', 'teacher'),
  checkUsername
);

// POST /api/v1/students/create — add a single student
studentsRouter.post('/create', requireAuth, requireRole('admin', 'teacher'), createStudent);

// GET /api/v1/students/:studentId — full profile (users + students joined)
studentsRouter.get('/:studentId', requireAuth, requireRole('admin', 'teacher', 'student'), studentDetails);

