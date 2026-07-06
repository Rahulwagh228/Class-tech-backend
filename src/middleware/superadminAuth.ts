import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import type { SuperadminJwtPayload } from '../models/Superadmin.model.js';

declare module 'express-serve-static-core' {
  interface Request {
    superadmin?: SuperadminJwtPayload;
  }
}

export function requireSuperadminAuth(req: Request, res: Response, next: NextFunction): void {
  if (!env.JWT_SECRET) {
    res.status(500).json({ msg: 'Server misconfigured: JWT_SECRET is not set' });
    return;
  }

  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ msg: 'Missing or invalid Authorization header' });
    return;
  }

  const token = header.slice('Bearer '.length).trim();

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as SuperadminJwtPayload;

    if (payload.role !== 'superadmin') {
      res.status(403).json({ msg: 'Insufficient permissions' });
      return;
    }

    req.superadmin = payload;
    next();
  } catch {
    res.status(401).json({ msg: 'Invalid or expired token' });
  }
}