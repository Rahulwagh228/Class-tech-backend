import { Router } from 'express';
import { listStudents } from '../controllers/students/list.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const studentsRouter = Router();

studentsRouter.get('/', requireAuth, requireRole('admin', 'teacher'), listStudents);
