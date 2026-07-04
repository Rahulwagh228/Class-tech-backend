import type { Request, Response } from 'express';
import pool from '../../../config/connectpsql.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface MarkRow {
  id: string;
  exam_id: string;
  exam_subject_id: string;
  subject: string;
  max_marks: string;
  pass_marks: string | null;
  student_id: string;
  student_name: string | null;
  student_username: string | null;
  enrollment_number: string | null;
  marks_obtained: string;
  remarks: string | null;
  is_absent: boolean;
  recorded_by: string;
  last_edited_by: string | null;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// GET /api/v1/exams/:examId/marks
//   admin OR teacher assigned to one of the exam's batches.
//
// Optional query params:
//   exam_subject_id  filter to one subject
//   batch_id         filter to one batch (joins through batch_students)
//
// Response: { count, records: [...] }
// =============================================================================
export const listExamMarks = async (req: Request, res: Response): Promise<void> => {
  if (!req.user || !req.exam) {
    res.status(401).json({ msg: 'Authentication required' });
    return;
  }

  const exam_id = req.exam.id;
  const tution_id = req.exam.tution_id;

  const examSubjectId = typeof req.query.exam_subject_id === 'string' ? req.query.exam_subject_id.trim() : '';
  const batchId = typeof req.query.batch_id === 'string' ? req.query.batch_id.trim() : '';

  if (examSubjectId && !UUID_RE.test(examSubjectId)) {
    res.status(400).json({ msg: 'exam_subject_id must be a valid UUID' });
    return;
  }
  if (batchId && !UUID_RE.test(batchId)) {
    res.status(400).json({ msg: 'batch_id must be a valid UUID' });
    return;
  }

  const values: string[] = [exam_id, tution_id];
  const where: string[] = ['em.exam_id = $1', 'em.tution_id = $2'];

  if (examSubjectId) {
    values.push(examSubjectId);
    where.push(`em.exam_subject_id = $${values.length}`);
  }

  let batchJoin = '';
  if (batchId) {
    values.push(batchId);
    batchJoin = `
      JOIN batch_students bs
        ON bs.student_id = em.student_id
       AND bs.batch_id = $${values.length}`;
  }

  try {
    const result = await pool.query<MarkRow>(
      `SELECT em.id,
              em.exam_id,
              em.exam_subject_id,
              es.subject,
              es.max_marks,
              es.pass_marks,
              em.student_id,
              u.name      AS student_name,
              u.username  AS student_username,
              s.enrollment_number,
              em.marks_obtained,
              em.remarks,
              em.is_absent,
              em.recorded_by,
              em.last_edited_by,
              em.created_at,
              em.updated_at
         FROM exam_marks em
         JOIN exam_subjects es ON es.id = em.exam_subject_id
         LEFT JOIN users u ON u.id = em.student_id
         LEFT JOIN students s ON s.user_id = em.student_id
         ${batchJoin}
        WHERE ${where.join(' AND ')}
        ORDER BY es.subject ASC, u.name ASC`,
      values
    );

    res.status(200).json({
      count: result.rows.length,
      records: result.rows.map((r) => ({
        id: r.id,
        exam_id: r.exam_id,
        exam_subject_id: r.exam_subject_id,
        subject: r.subject,
        max_marks: Number(r.max_marks),
        pass_marks: r.pass_marks === null ? null : Number(r.pass_marks),
        marks_obtained: Number(r.marks_obtained),
        remarks: r.remarks,
        is_absent: r.is_absent,
        recorded_by: r.recorded_by,
        last_edited_by: r.last_edited_by,
        created_at: r.created_at,
        updated_at: r.updated_at,
        student: {
          id: r.student_id,
          name: r.student_name,
          username: r.student_username,
          enrollment_number: r.enrollment_number
        }
      }))
    });
  } catch (err) {
    console.error('listExamMarks error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};
