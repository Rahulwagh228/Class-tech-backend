import { Router } from 'express';
import { getSuperadminDashboard } from '../controllers/superadmin/dashboard.js';
import { loginSuperadmin } from '../controllers/superadmin/auth.js';
import { addTutionAdmin, createTution } from '../controllers/superadmin/tutions.js';
import { requireSuperadminAuth } from '../middleware/superadminAuth.js';

export const superadminRouter = Router();

// Login-only surface for the global superadmin account.
superadminRouter.post('/login', loginSuperadmin);

// Protected platform-wide dashboard.
superadminRouter.get('/dashboard', requireSuperadminAuth, getSuperadminDashboard);

// Create a tution and store the authenticated superadmin as creator.
superadminRouter.post('/tutions', requireSuperadminAuth, createTution);

// Add an admin user for a specific tution.
superadminRouter.post('/tutions/:tutionId/admins', requireSuperadminAuth, addTutionAdmin);