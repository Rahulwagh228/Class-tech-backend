import { Router } from 'express';
import { dashboardSummary } from '../controllers/dashboard/summary.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const dashboardRouter = Router();

// GET /api/v1/dashboard/summary - admin only
dashboardRouter.get('/summary', requireAuth, requireRole('admin'), dashboardSummary);
