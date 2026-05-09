import { Router } from 'express';
import { createBatch } from '../controllers/batches/create.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const batchesRouter = Router();

// POST /api/v1/batches/create — create a batch and enroll students
batchesRouter.post('/create', requireAuth, requireRole('admin', 'teacher'), createBatch);