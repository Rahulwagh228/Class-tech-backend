import { Router } from 'express';
import { removeAttendance } from '../controllers/attendance/remove.js';
import { batchDetails } from '../controllers/batches/details.js';
import { listBatches } from '../controllers/batches/list.js';
import { assignBatchTeachers } from '../controllers/batches/teachers/assign.js';
import { unassignBatchTeacher } from '../controllers/batches/teachers/unassign.js';
import { dashboardSummary } from '../controllers/dashboard/summary.js';
import { createExam } from '../controllers/exams/create.js';
import { checkTeacherUsername, createTeacher } from '../controllers/teachers/create.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const adminRouter = Router();

// Every route in this router is admin-only.
adminRouter.use(requireAuth, requireRole('admin'));

// ── Dashboard ───────────────────────────────────────────────────────────────
adminRouter.get('/dashboard/summary', dashboardSummary);

// ── Batches (admin-owned CRUD) ──────────────────────────────────────────────
adminRouter.get('/batches', listBatches);
adminRouter.get('/batches/:batchId', batchDetails);
adminRouter.post('/batches/:batchId/teachers', assignBatchTeachers);
adminRouter.delete('/batches/:batchId/teachers/:teacherId', unassignBatchTeacher);

// ── Teachers (create + username check are admin-only) ───────────────────────
adminRouter.post('/teachers', createTeacher);
adminRouter.post('/teachers/check-username', checkTeacherUsername);

// ── Attendance (admin-only destructive ops) ─────────────────────────────────
adminRouter.delete('/attendance/:recordId', removeAttendance);

// ── Exams (creation is admin-only) ──────────────────────────────────────────
adminRouter.post('/exams', createExam);
