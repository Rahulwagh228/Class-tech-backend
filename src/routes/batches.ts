import { Router } from 'express';
import { createBatch } from '../controllers/batches/create.js';
import { batchDetails } from '../controllers/batches/details.js';
import { listBatches } from '../controllers/batches/list.js';
import { assignBatchTeachers } from '../controllers/batches/teachers/assign.js';
import { listBatchTeachers } from '../controllers/batches/teachers/list.js';
import { unassignBatchTeacher } from '../controllers/batches/teachers/unassign.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { requireBatchAccess } from '../middleware/batchAccess.js';

export const batchesRouter = Router();

// GET /api/v1/batches — list batches (admin only)
batchesRouter.get('/', requireAuth, requireRole('admin'), listBatches);

// GET /api/v1/batches/:batchId — batch details (admin only)
batchesRouter.get('/:batchId', requireAuth, requireRole('admin'), batchDetails);

// POST /api/v1/batches/create — create a batch and enroll students
batchesRouter.post('/create', requireAuth, requireRole('admin', 'teacher'), createBatch);

// =============================================================================
// Teacher assignments on a batch.
// - GET list — admin OR any teacher assigned to the batch
// - POST assign — admin only
// - DELETE unassign — admin only
// =============================================================================

// GET /api/v1/batches/:batchId/teachers
batchesRouter.get(
  '/:batchId/teachers',
  requireAuth,
  requireRole('admin', 'teacher'),
  requireBatchAccess,
  listBatchTeachers
);

// POST /api/v1/batches/:batchId/teachers
batchesRouter.post(
  '/:batchId/teachers',
  requireAuth,
  requireRole('admin'),
  assignBatchTeachers
);

// DELETE /api/v1/batches/:batchId/teachers/:teacherId
batchesRouter.delete(
  '/:batchId/teachers/:teacherId',
  requireAuth,
  requireRole('admin'),
  unassignBatchTeacher
);
