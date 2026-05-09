import { Router } from 'express';
import { listAttendance } from '../controllers/attendance/list.js';
import { markAttendance } from '../controllers/attendance/mark.js';
import { removeAttendance } from '../controllers/attendance/remove.js';
import { studentBatchDetail } from '../controllers/attendance/studentBatchDetail.js';
import { studentBatches } from '../controllers/attendance/studentBatches.js';
import { studentHeatmap } from '../controllers/attendance/studentHeatmap.js';
import { studentAttendanceHistory } from '../controllers/attendance/studentHistory.js';
import { attendanceSummary } from '../controllers/attendance/summary.js';
import { updateAttendance } from '../controllers/attendance/update.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { requireBatchAccess } from '../middleware/batchAccess.js';
import { fillSelfStudentId, requireStudentAccess } from '../middleware/studentAccess.js';

export const attendanceRouter = Router();

// =============================================================================
// Per-batch routes — for teachers/admins managing attendance.
// =============================================================================

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

// =============================================================================
// Per-student routes — for the student themselves, an admin, or a linked parent.
// requireStudentAccess centralizes that auth rule.
// =============================================================================

// GET /api/v1/attendance/students/:studentId
attendanceRouter.get(
  '/students/:studentId',
  requireAuth,
  requireRole('admin', 'student', 'parent'),
  requireStudentAccess,
  studentAttendanceHistory
);

// GET /api/v1/attendance/students/:studentId/heatmap
attendanceRouter.get(
  '/students/:studentId/heatmap',
  requireAuth,
  requireRole('admin', 'student', 'parent'),
  requireStudentAccess,
  studentHeatmap
);

// GET /api/v1/attendance/students/:studentId/batches
attendanceRouter.get(
  '/students/:studentId/batches',
  requireAuth,
  requireRole('admin', 'student', 'parent'),
  requireStudentAccess,
  studentBatches
);

// GET /api/v1/attendance/students/:studentId/batches/:batchId
attendanceRouter.get(
  '/students/:studentId/batches/:batchId',
  requireAuth,
  requireRole('admin', 'student', 'parent'),
  requireStudentAccess,
  studentBatchDetail
);

// =============================================================================
// /me convenience routes — students hitting their own records by JWT only.
// fillSelfStudentId injects req.user.id as :studentId so we reuse the same
// controllers as /students/:studentId/...
// =============================================================================

attendanceRouter.get('/me', requireAuth, fillSelfStudentId, studentAttendanceHistory);
attendanceRouter.get('/me/heatmap', requireAuth, fillSelfStudentId, studentHeatmap);
attendanceRouter.get('/me/batches', requireAuth, fillSelfStudentId, studentBatches);
attendanceRouter.get(
  '/me/batches/:batchId',
  requireAuth,
  fillSelfStudentId,
  studentBatchDetail
);

// =============================================================================
// Single-record edit / delete — controllers do their own ownership checks.
// =============================================================================

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
