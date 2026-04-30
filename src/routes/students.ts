import { Router } from 'express';
import { listStudents } from '../controllers/students/list.js';
import { studentDetails } from '../controllers/students/details.js';
import { studentLogin } from '../controllers/students/auth.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const studentsRouter = Router();

// ── Public ───────────────────────────────────────────────────────────────────
// POST /api/v1/students/auth/login
// Body: { identifier: string (email or username), password: string }
studentsRouter.post('/auth/login', studentLogin);

// ── Protected (admin / teacher only) ─────────────────────────────────────────
studentsRouter.get('/', requireAuth, requireRole('admin', 'teacher'), listStudents);

// GET /api/v1/students/:studentId — full profile (users + students joined)
studentsRouter.get('/:studentId', requireAuth, requireRole('admin', 'teacher'), studentDetails);

