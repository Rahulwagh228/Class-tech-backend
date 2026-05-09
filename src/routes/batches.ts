import { Router } from 'express';
import { createBatch } from '../controllers/batches/create.js';
import { batchDetails } from '../controllers/batches/details.js';
import { listBatches } from '../controllers/batches/list.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const batchesRouter = Router();

// POST /api/v1/batches/create — create a batch and enroll students
// GET /api/v1/batches — list batches (admin only)
batchesRouter.get('/', requireAuth, requireRole('admin'), listBatches);

// GET /api/v1/batches/:batchId — batch details (admin only)
batchesRouter.get('/:batchId', requireAuth, requireRole('admin'), batchDetails);

// POST /api/v1/batches/create — create a batch and enroll students
batchesRouter.post('/create', requireAuth, requireRole('admin', 'teacher'), createBatch);