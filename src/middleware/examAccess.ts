import type { NextFunction, Request, Response } from 'express';
import pool from '../config/connectpsql.js';

export interface ExamContext {
  id: string;
  tution_id: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    exam?: ExamContext;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Loads the exam identified by req.params.examId and enforces:
//   1. The exam exists.
//   2. The exam belongs to the caller's tution_id.
//   3. Caller is admin OR (teacher AND assigned to at least one batch that
//      participates in this exam).
//
// Returns 404 (not 403) on cross-tenant lookups so we don't leak existence
// of other institutions' exams.
export async function requireExamAccess(
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

  const examId = req.params.examId as string | undefined;
  if (!examId || !UUID_RE.test(examId)) {
    res.status(400).json({ msg: 'examId must be a valid UUID' });
    return;
  }

  try {
    const examResult = await pool.query<ExamContext>(
      `SELECT id, tution_id FROM exams WHERE id = $1 AND tution_id = $2`,
      [examId, tution_id]
    );

    const exam = examResult.rows[0];
    if (!exam) {
      res.status(404).json({ msg: 'Exam not found' });
      return;
    }

    const role = req.user.role;
    if (role === 'admin') {
      req.exam = exam;
      next();
      return;
    }

    if (role === 'teacher') {
      const linkResult = await pool.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1
             FROM exam_batches eb
             JOIN batch_teachers bt
               ON bt.batch_id = eb.batch_id
            WHERE eb.exam_id = $1
              AND bt.teacher_user_id = $2
         ) AS exists`,
        [exam.id, req.user.id]
      );
      if (linkResult.rows[0]?.exists) {
        req.exam = exam;
        next();
        return;
      }
    }

    res.status(403).json({ msg: 'Not authorized to access this exam' });
  } catch (err) {
    console.error('requireExamAccess: lookup failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
}
