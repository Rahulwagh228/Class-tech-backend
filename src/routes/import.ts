import { Router } from 'express';
import { importStudents } from '../controllers/students/import.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';

export const importRouter = Router();

// Only admins (and optionally teachers) can bulk-import students.
// Field name is "file" - the frontend should send:
//   FormData: form.append('file', fileBlob)
importRouter.post(
  '/importStudent',
  requireAuth,
  requireRole('admin', 'teacher'),
  upload.single('file'),
  importStudents
);
