import { Router } from 'express';
import { createExam } from '../controllers/exams/create.js';
import { examDetails } from '../controllers/exams/details.js';
import { listExams } from '../controllers/exams/list.js';
import { listExamMarks } from '../controllers/exams/marks/list.js';
import { studentExamMarks } from '../controllers/exams/marks/studentMarks.js';
import { upsertExamMarks } from '../controllers/exams/marks/upsert.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { requireExamAccess } from '../middleware/examAccess.js';
import { fillSelfStudentId, requireStudentAccess } from '../middleware/studentAccess.js';

export const examsRouter = Router();

// =============================================================================
// Static / literal paths first — before any `/:examId` pattern.
// Otherwise Express matches `/me` and `/students/...` against `/:examId` and
// applies the wrong role check (admin/teacher only), returning 403 to students.
// =============================================================================

// GET /api/v1/exams/me   — student-only convenience, reuses studentExamMarks
examsRouter.get(
  '/me',
  requireAuth,
  requireRole('student'),
  fillSelfStudentId,
  studentExamMarks
);

// GET /api/v1/exams/students/:studentId
examsRouter.get(
  '/students/:studentId',
  requireAuth,
  requireRole('admin', 'student', 'parent'),
  requireStudentAccess,
  studentExamMarks
);

// =============================================================================
// Exam header CRUD-ish — admin creates, admin + assigned teachers can view.
// =============================================================================

// POST /api/v1/exams                — create an exam (admin only)
examsRouter.post('/', requireAuth, requireRole('admin'), createExam);

// GET  /api/v1/exams                — list exams (admin: all, teacher: their batches')
examsRouter.get('/', requireAuth, requireRole('admin', 'teacher'), listExams);

// =============================================================================
// Marks — teachers record, admin can also record/edit, teacher must be
// assigned to one of the exam's batches.
// =============================================================================

// POST /api/v1/exams/:examId/marks  — bulk upsert marks for one subject
examsRouter.post(
  '/:examId/marks',
  requireAuth,
  requireRole('admin', 'teacher'),
  requireExamAccess,
  upsertExamMarks
);

// GET  /api/v1/exams/:examId/marks  — list marks (filter by exam_subject_id / batch_id)
examsRouter.get(
  '/:examId/marks',
  requireAuth,
  requireRole('admin', 'teacher'),
  requireExamAccess,
  listExamMarks
);

// GET  /api/v1/exams/:examId        — exam details (admin or assigned teacher)
examsRouter.get(
  '/:examId',
  requireAuth,
  requireRole('admin', 'teacher'),
  requireExamAccess,
  examDetails
);
