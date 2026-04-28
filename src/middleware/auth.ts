import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import type { JwtPayload, UserRole } from '../models/User.model.js';

declare module 'express-serve-static-core' {
  interface Request {
    user?: JwtPayload;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ msg: 'Missing or invalid Authorization header' });
    return;
  }
  const token = header.slice('Bearer '.length).trim();
  try {
    req.user = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    next();
  } catch {
    res.status(401).json({ msg: 'Invalid or expired token' });
  }
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ msg: 'Authentication required' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ msg: 'Insufficient permissions' });
      return;
    }
    next();
  };
}
