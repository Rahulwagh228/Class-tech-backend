import { Router } from 'express';
import { listAttendance } from '../controllers/attendance/list.js';
import { markAttendance } from '../controllers/attendance/mark.js';
import { attendanceSummary } from '../controllers/attendance/summary.js';
import { updateAttendance } from '../controllers/attendance/update.js';
import { createBatch } from '../controllers/batches/create.js';
import { addStudentsToBatch } from '../controllers/batches/students/add.js';
import { listBatchTeachers } from '../controllers/batches/teachers/list.js';
import { examDetails } from '../controllers/exams/details.js';
import { listExams } from '../controllers/exams/list.js';
import { listExamMarks } from '../controllers/exams/marks/list.js';
import { upsertExamMarks } from '../controllers/exams/marks/upsert.js';
import { checkUsername, createStudent } from '../controllers/students/create.js';
import { studentDetails } from '../controllers/students/details.js';
import { importStudents, previewImport } from '../controllers/students/import.js';
import { listStudents } from '../controllers/students/list.js';
import { teacherDetails } from '../controllers/teachers/details.js';
import { listTeachers } from '../controllers/teachers/list.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { requireBatchAccess } from '../middleware/batchAccess.js';
import { requireExamAccess } from '../middleware/examAccess.js';
import { upload } from '../middleware/upload.js';

export const teacherRouter = Router();

// Admin can do everything a teacher can, so admin is included at this level.
teacherRouter.use(requireAuth, requireRole('admin', 'teacher'));

// ── Batches (create + teacher-facing views) ─────────────────────────────────
teacherRouter.post('/batches', createBatch);
teacherRouter.get('/batches/:batchId/teachers', requireBatchAccess, listBatchTeachers);
teacherRouter.post('/batches/:batchId/students', requireBatchAccess, addStudentsToBatch);

// ── Students (list, view, create, bulk import) ──────────────────────────────
teacherRouter.get('/students', listStudents);
teacherRouter.post('/students', createStudent);
teacherRouter.post('/students/check-username', checkUsername);
teacherRouter.get('/students/:studentId', studentDetails);
teacherRouter.post('/students/import/preview', upload.single('file'), previewImport);
teacherRouter.post('/students/import', importStudents);

// ── Teachers (list + details, admin+teacher scope) ──────────────────────────
teacherRouter.get('/teachers', listTeachers);
teacherRouter.get('/teachers/:teacherId', teacherDetails);

// ── Attendance (mark, list per batch, edit) ─────────────────────────────────
teacherRouter.post(
  '/attendance/batches/:batchId/mark',
  requireBatchAccess,
  markAttendance
);
teacherRouter.get('/attendance/batches/:batchId', requireBatchAccess, listAttendance);
teacherRouter.get(
  '/attendance/batches/:batchId/summary',
  requireBatchAccess,
  attendanceSummary
);
teacherRouter.patch('/attendance/:recordId', updateAttendance);

// ── Exams (list, view details, marks CRUD) ──────────────────────────────────
teacherRouter.get('/exams', listExams);
teacherRouter.get('/exams/:examId', requireExamAccess, examDetails);
teacherRouter.get('/exams/:examId/marks', requireExamAccess, listExamMarks);
teacherRouter.post('/exams/:examId/marks', requireExamAccess, upsertExamMarks);
