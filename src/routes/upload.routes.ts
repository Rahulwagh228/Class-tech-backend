import { Router } from 'express';
import { cloudinarySignature } from '../controllers/uploads/cloudinarySignature.js';
import { requireAuth } from '../middleware/auth.js';

export const uploadRouter = Router();

// Every user with a valid JWT can request an upload signature (students for
// profile photos, teachers/admins for whatever assets their UI exposes).
uploadRouter.use(requireAuth);

uploadRouter.get('/cloudinary-signature', cloudinarySignature);
