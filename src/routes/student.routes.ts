import { Router } from 'express';
import { studentBatchDetail } from '../controllers/attendance/studentBatchDetail.js';
import { studentBatches } from '../controllers/attendance/studentBatches.js';
import { studentHeatmap } from '../controllers/attendance/studentHeatmap.js';
import { studentAttendanceHistory } from '../controllers/attendance/studentHistory.js';
import { studentExamMarks } from '../controllers/exams/marks/studentMarks.js';
import { studentDetails } from '../controllers/students/details.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { fillSelfStudentId, requireStudentAccess } from '../middleware/studentAccess.js';

export const studentRouter = Router();

// All routes require auth. Role checks vary between /me (student-only)
// and /:studentId (admin/student/parent, with per-student access enforcement).
studentRouter.use(requireAuth);

// ── /me — student's own data (JWT only, no :studentId needed) ───────────────
studentRouter.get('/me', requireRole('student'), fillSelfStudentId, studentDetails);
studentRouter.get(
  '/attendance/me',
  requireRole('student'),
  fillSelfStudentId,
  studentAttendanceHistory
);
studentRouter.get(
  '/attendance/me/heatmap',
  requireRole('student'),
  fillSelfStudentId,
  studentHeatmap
);
studentRouter.get(
  '/attendance/me/batches',
  requireRole('student'),
  fillSelfStudentId,
  studentBatches
);
studentRouter.get(
  '/attendance/me/batches/:batchId',
  requireRole('student'),
  fillSelfStudentId,
  studentBatchDetail
);
studentRouter.get('/exams/me', requireRole('student'), fillSelfStudentId, studentExamMarks);

// ── /:studentId — admin / student / parent view, gated by requireStudentAccess
studentRouter.get(
  '/:studentId',
  requireRole('admin', 'teacher', 'student'),
  studentDetails
);
studentRouter.get(
  '/attendance/:studentId',
  requireRole('admin', 'student', 'parent'),
  requireStudentAccess,
  studentAttendanceHistory
);
studentRouter.get(
  '/attendance/:studentId/heatmap',
  requireRole('admin', 'student', 'parent'),
  requireStudentAccess,
  studentHeatmap
);
studentRouter.get(
  '/attendance/:studentId/batches',
  requireRole('admin', 'student', 'parent'),
  requireStudentAccess,
  studentBatches
);
studentRouter.get(
  '/attendance/:studentId/batches/:batchId',
  requireRole('admin', 'student', 'parent'),
  requireStudentAccess,
  studentBatchDetail
);
studentRouter.get(
  '/exams/:studentId',
  requireRole('admin', 'student', 'parent'),
  requireStudentAccess,
  studentExamMarks
);
