import type { Request, Response } from 'express';
import pool from '../../config/connectpsql.js';

interface ExamListRow {
  id: string;
  name: string;
  code: string;
  description: string | null;
  start_date: string;
  end_date: string | null;
  created_at: string;
  subject_count: string;
  batch_count: string;
}

// =============================================================================
// GET /api/v1/exams
//   - admin   : all exams in the tution
//   - teacher : only exams whose batches include one this teacher is assigned to
//
// Response: { exams: [...] }
// =============================================================================
export const listExams = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ msg: 'Authentication required' });
    return;
  }
  const tution_id = req.user.tution_id;
  if (!tution_id) {
    res.status(400).json({ msg: 'Token has no tution_id' });
    return;
  }

  try {
    let result;
    if (req.user.role === 'admin') {
      result = await pool.query<ExamListRow>(
        `SELECT e.id, e.name, e.code, e.description, e.start_date, e.end_date, e.created_at,
                (SELECT COUNT(*) FROM exam_subjects es WHERE es.exam_id = e.id) AS subject_count,
                (SELECT COUNT(*) FROM exam_batches eb WHERE eb.exam_id = e.id) AS batch_count
           FROM exams e
          WHERE e.tution_id = $1
          ORDER BY e.start_date DESC, e.created_at DESC`,
        [tution_id]
      );
    } else if (req.user.role === 'teacher') {
      result = await pool.query<ExamListRow>(
        `SELECT DISTINCT e.id, e.name, e.code, e.description, e.start_date, e.end_date, e.created_at,
                (SELECT COUNT(*) FROM exam_subjects es WHERE es.exam_id = e.id) AS subject_count,
                (SELECT COUNT(*) FROM exam_batches eb WHERE eb.exam_id = e.id) AS batch_count
           FROM exams e
           JOIN exam_batches eb ON eb.exam_id = e.id
           JOIN batch_teachers bt ON bt.batch_id = eb.batch_id
          WHERE e.tution_id = $1
            AND bt.teacher_user_id = $2
          ORDER BY e.start_date DESC, e.created_at DESC`,
        [tution_id, req.user.id]
      );
    } else {
      res.status(403).json({ msg: 'Insufficient permissions' });
      return;
    }

    res.status(200).json({
      exams: result.rows.map((r) => ({
        id: r.id,
        name: r.name,
        code: r.code,
        description: r.description,
        start_date: r.start_date,
        end_date: r.end_date,
        created_at: r.created_at,
        subject_count: Number(r.subject_count),
        batch_count: Number(r.batch_count)
      }))
    });
  } catch (err) {
    console.error('listExams error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};
