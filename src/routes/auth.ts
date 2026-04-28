import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import { userRepository } from '../repositories/userRepository.js';
import { AuthService, toPublicUser } from '../services/authService.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const authService = new AuthService(userRepository);

const signupSchema = z.object({
  name: z.string().min(1).max(80),
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_.-]+$/, 'Username may only contain letters, numbers, _ . -'),
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
  profilePhoto: z.string().url().max(2048).optional().nullable(),
  role: z.enum(['admin', 'student', 'parent'])
});

const loginSchema = z.object({
  emailOrUsername: z.string().min(1),
  password: z.string().min(1)
});

const resendSchema = z.object({
  email: z.string().email()
});

const verifyQuerySchema = z.object({
  token: z.string().min(10)
});

export const authRouter = Router();

authRouter.post('/signup', async (request, response, next) => {
  try {
    const input = signupSchema.parse(request.body);
    const result = await authService.signup(input);
    response.status(201).json({ data: result });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/login', async (request, response, next) => {
  try {
    const input = loginSchema.parse(request.body);
    const result = await authService.login(input);
    response.json({ data: result });
  } catch (error) {
    next(error);
  }
});

authRouter.get('/verify-email', (request, response, next) => {
  try {
    const { token } = verifyQuerySchema.parse(request.query);
    const user = authService.verifyEmail(token);
    response.json({ data: { user, message: 'Email verified successfully' } });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/resend-verification', async (request, response, next) => {
  try {
    const { email } = resendSchema.parse(request.body);
    await authService.resendVerification(email);
    response.json({ data: { message: 'If an account exists, a verification email has been sent' } });
  } catch (error) {
    next(error);
  }
});

authRouter.get('/me', requireAuth, (request, response, next) => {
  try {
    if (!request.user) throw new AppError('Authentication required', 401);
    const user = userRepository.findById(request.user.sub);
    if (!user) throw new AppError('User not found', 404);
    response.json({ data: toPublicUser(user) });
  } catch (error) {
    next(error);
  }
});

authRouter.get('/admin/ping', requireAuth, requireRole('admin'), (_request, response) => {
  response.json({ data: { message: 'admin access granted' } });
});

authRouter.use((error: unknown, _request: Request, _response: Response, next: NextFunction) => {
  if (error instanceof z.ZodError) {
    next(new AppError(error.issues[0]?.message ?? 'Validation failed', 400));
    return;
  }
  next(error);
});
