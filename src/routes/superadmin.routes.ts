import { Router } from 'express';
import { loginSuperadmin } from '../controllers/superadmin/auth.js';

export const superadminRouter = Router();

// Login-only surface for the global superadmin account.
superadminRouter.post('/login', loginSuperadmin);