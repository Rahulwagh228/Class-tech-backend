import { Router } from 'express';
import { previewImport, importStudents } from '../controllers/students/import.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';

export const importRouter = Router();

// Only admins (and optionally teachers) can bulk-import students.

// Step 1 — Upload file & get headers for column mapping
// Field name is "file" - the frontend should send:
//   FormData: form.append('file', fileBlob)
importRouter.post(
  '/importStudent/preview',
  requireAuth,
  requireRole('admin', 'teacher'),
  upload.single('file'),
  previewImport
);

// Step 2 — Send mapping + file_id to apply, validate & insert
// Body: JSON { file_id: string, mapping: { email: "Excel Header", ... } }
importRouter.post(
  '/importStudent/import',
  requireAuth,
  requireRole('admin', 'teacher'),
  importStudents
);
