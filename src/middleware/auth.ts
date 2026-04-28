import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import type { AuthTokenPayload } from '../services/authService.js';
import type { UserRole } from '../repositories/userRepository.js';

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthTokenPayload;
  }
}

export function requireAuth(request: Request, _response: Response, next: NextFunction): void {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return next(new AppError('Missing or invalid Authorization header', 401));
  }

  const token = header.slice('Bearer '.length).trim();
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as AuthTokenPayload;
    request.user = decoded;
    next();
  } catch {
    next(new AppError('Invalid or expired token', 401));
  }
}

export function requireRole(...roles: UserRole[]) {
  return (request: Request, _response: Response, next: NextFunction): void => {
    if (!request.user) {
      return next(new AppError('Authentication required', 401));
    }
    if (!roles.includes(request.user.role)) {
      return next(new AppError('Insufficient permissions', 403));
    }
    next();
  };
}
