import { Router } from 'express';
import { listChildren } from '../controllers/parents/listChildren.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const parentsRouter = Router();

// GET /api/v1/parents/me/children — list children linked to the calling parent.
parentsRouter.get('/me/children', requireAuth, requireRole('parent'), listChildren);
