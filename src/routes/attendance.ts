import { Router } from 'express';
import { listAttendance } from '../controllers/attendance/list.js';
import { markAttendance } from '../controllers/attendance/mark.js';
import { removeAttendance } from '../controllers/attendance/remove.js';
import { studentAttendanceHistory } from '../controllers/attendance/studentHistory.js';
import { attendanceSummary } from '../controllers/attendance/summary.js';
import { updateAttendance } from '../controllers/attendance/update.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { requireBatchAccess } from '../middleware/batchAccess.js';

export const attendanceRouter = Router();

// Per-batch routes: requireBatchAccess does the tenant + ownership check.
// POST /api/v1/attendance/batches/:batchId/mark
attendanceRouter.post(
  '/batches/:batchId/mark',
  requireAuth,
  requireRole('admin', 'teacher'),
  requireBatchAccess,
  markAttendance
);

// GET /api/v1/attendance/batches/:batchId
attendanceRouter.get(
  '/batches/:batchId',
  requireAuth,
  requireRole('admin', 'teacher'),
  requireBatchAccess,
  listAttendance
);

// GET /api/v1/attendance/batches/:batchId/summary
attendanceRouter.get(
  '/batches/:batchId/summary',
  requireAuth,
  requireRole('admin', 'teacher'),
  requireBatchAccess,
  attendanceSummary
);

// Student history — admin or the student themselves.
// GET /api/v1/attendance/students/:studentId
attendanceRouter.get(
  '/students/:studentId',
  requireAuth,
  requireRole('admin', 'student'),
  studentAttendanceHistory
);

// Single-record edit / delete — controllers do their own ownership checks.
// PATCH /api/v1/attendance/:recordId
attendanceRouter.patch(
  '/:recordId',
  requireAuth,
  requireRole('admin', 'teacher'),
  updateAttendance
);

// DELETE /api/v1/attendance/:recordId
attendanceRouter.delete(
  '/:recordId',
  requireAuth,
  requireRole('admin'),
  removeAttendance
);
