import type { Request, Response } from 'express';
import pool from '../../config/connectpsql.js';

// =============================================================================
// GET /api/v1/exams/:examId
//
// requireExamAccess has already validated tenant and (for teachers) batch
// assignment, so we just hydrate the full record.
//
// Response: { exam, batches: [...], subjects: [...] }
// =============================================================================
export const examDetails = async (req: Request, res: Response): Promise<void> => {
  if (!req.user || !req.exam) {
    res.status(401).json({ msg: 'Authentication required' });
    return;
  }

  const examId = req.exam.id;
  const tution_id = req.exam.tution_id;

  try {
    const [examRes, batchRes, subjectRes] = await Promise.all([
      pool.query(
        `SELECT id, tution_id, name, code, description, start_date, end_date,
                created_by, created_at, updated_at
           FROM exams
          WHERE id = $1`,
        [examId]
      ),
      pool.query(
        `SELECT b.id, b.name, b.code, b.subject, b.start_date, b.end_date
           FROM exam_batches eb
           JOIN batches b ON b.id = eb.batch_id
          WHERE eb.exam_id = $1 AND eb.tution_id = $2
          ORDER BY b.name ASC`,
        [examId, tution_id]
      ),
      pool.query(
        `SELECT id, subject, max_marks, pass_marks, exam_date, created_at
           FROM exam_subjects
          WHERE exam_id = $1
          ORDER BY exam_date NULLS LAST, subject ASC`,
        [examId]
      )
    ]);

    const exam = examRes.rows[0] ?? null;
    if (!exam) {
      res.status(404).json({ msg: 'Exam not found' });
      return;
    }

    res.status(200).json({
      exam,
      batches: batchRes.rows,
      subjects: subjectRes.rows
    });
  } catch (err) {
    console.error('examDetails error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};
