import { Router } from 'express';
import { listStudents } from '../controllers/students/list.js';
import { studentDetails } from '../controllers/students/details.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const studentsRouter = Router();

studentsRouter.get('/', requireAuth, requireRole('admin', 'teacher'), listStudents);

// GET /api/v1/students/:studentId — full profile (users + students joined)
studentsRouter.get('/:studentId', requireAuth, requireRole('admin', 'teacher'), studentDetails);
