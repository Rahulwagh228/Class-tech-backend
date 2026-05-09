import type { NextFunction, Request, Response } from 'express';
import supabase from '../config/connectSupabase.js';

export interface BatchContext {
  id: string;
  tution_id: string;
  teacher_id: string | null;
}

declare module 'express-serve-static-core' {
  interface Request {
    batch?: BatchContext;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Loads the batch identified by req.params.batchId, then enforces:
//   1. The batch exists.
//   2. The batch belongs to the caller's institution (tution_id).
//   3. The caller is admin OR (teacher AND batch.teacher_id === caller.id).
//
// On success it attaches req.batch and calls next(). Returns 404 (not 403)
// for cross-tenant access so we don't leak existence of other institutions'
// batches.
export async function requireBatchAccess(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ msg: 'Authentication required' });
    return;
  }

  const tution_id = req.user.tution_id;
  if (!tution_id) {
    res.status(400).json({ msg: 'Token has no tution_id' });
    return;
  }

  const batchId = req.params.batchId as string | undefined;
  if (!batchId) {
    res.status(400).json({ msg: 'batchId param is required' });
    return;
  }
  if (!UUID_RE.test(batchId)) {
    res.status(400).json({ msg: 'batchId must be a valid UUID' });
    return;
  }

  const { data: batch, error } = await supabase
    .from('batches')
    .select('id, tution_id, teacher_id')
    .eq('id', batchId)
    .eq('tution_id', tution_id)
    .maybeSingle<BatchContext>();

  if (error) {
    console.error('requireBatchAccess: batch lookup failed:', error);
    res.status(500).json({ msg: 'Server error' });
    return;
  }

  if (!batch) {
    res.status(404).json({ msg: 'Batch not found' });
    return;
  }

  const role = req.user.role;
  if (role === 'admin') {
    req.batch = batch;
    next();
    return;
  }

  if (role === 'teacher' && batch.teacher_id === req.user.id) {
    req.batch = batch;
    next();
    return;
  }

  res.status(403).json({ msg: 'Not authorized to manage this batch' });
}
