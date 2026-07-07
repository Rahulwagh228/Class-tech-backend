import { Router } from 'express';
import { parentPendingFees } from '../controllers/fees/parentPending.js';
import { listChildren } from '../controllers/parents/listChildren.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const parentRouter = Router();

parentRouter.use(requireAuth, requireRole('parent'));

// ── Children linked to the calling parent ───────────────────────────────────
parentRouter.get('/children', listChildren);

// ── Fees (pending only, for linked children) ────────────────────────────────
parentRouter.get('/fees/pending', parentPendingFees);
