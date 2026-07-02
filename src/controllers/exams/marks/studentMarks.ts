import type { Request, Response } from 'express';
import pool from '../../../config/connectpsql.js';

interface StudentMarkRow {
  exam_id: string;
  exam_name: string;
  exam_code: string;
  exam_start_date: string;
  exam_end_date: string | null;
  mark_id: string | null;
  exam_subject_id: string;
  subject: string;
  max_marks: string;
  pass_marks: string | null;
  exam_date: string | null;
  marks_obtained: string | null;
  remarks: string | null;
  is_absent: boolean | null;
  updated_at: string | null;
}

// =============================================================================
// GET /api/v1/exams/students/:studentId
// GET /api/v1/exams/me                    (student-only convenience)
//
// requireStudentAccess (for /students/:studentId) already enforced:
//   - admin, the student themselves, or a linked parent.
//
// Returns the student's marks across every exam where one of their enrolled
// batches participates. Subjects with no mark row yet are returned with
// marks_obtained = null so the UI can show "not yet recorded".
// =============================================================================
export const studentExamMarks = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ msg: 'Authentication required' });
    return;
  }

  const studentId = req.params.studentId;
  if (!studentId) {
    res.status(400).json({ msg: 'studentId is required' });
    return;
  }

  const tution_id = req.user.tution_id;

  try {
    const result = await pool.query<StudentMarkRow>(
      `SELECT e.id            AS exam_id,
              e.name          AS exam_name,
              e.code          AS exam_code,
              e.start_date    AS exam_start_date,
              e.end_date      AS exam_end_date,
              em.id           AS mark_id,
              es.id           AS exam_subject_id,
              es.subject      AS subject,
              es.max_marks    AS max_marks,
              es.pass_marks   AS pass_marks,
              es.exam_date    AS exam_date,
              em.marks_obtained,
              em.remarks,
              em.is_absent,
              em.updated_at
         FROM exams e
         JOIN exam_batches eb ON eb.exam_id = e.id
         JOIN batch_students bs
           ON bs.batch_id = eb.batch_id
          AND bs.student_id = $1
         JOIN exam_subjects es ON es.exam_id = e.id
         LEFT JOIN exam_marks em
           ON em.exam_subject_id = es.id
          AND em.student_id = $1
        WHERE e.tution_id = $2
        ORDER BY e.start_date DESC, e.created_at DESC, es.subject ASC`,
      [studentId, tution_id]
    );

    // group by exam_id
    const byExam = new Map<string, {
      exam_id: string;
      name: string;
      code: string;
      start_date: string;
      end_date: string | null;
      subjects: Array<{
        exam_subject_id: string;
        subject: string;
        max_marks: number;
        pass_marks: number | null;
        exam_date: string | null;
        marks_obtained: number | null;
        remarks: string | null;
        is_absent: boolean | null;
        recorded: boolean;
        updated_at: string | null;
      }>;
    }>();

    for (const r of result.rows) {
      let entry = byExam.get(r.exam_id);
      if (!entry) {
        entry = {
          exam_id: r.exam_id,
          name: r.exam_name,
          code: r.exam_code,
          start_date: r.exam_start_date,
          end_date: r.exam_end_date,
          subjects: []
        };
        byExam.set(r.exam_id, entry);
      }
      entry.subjects.push({
        exam_subject_id: r.exam_subject_id,
        subject: r.subject,
        max_marks: Number(r.max_marks),
        pass_marks: r.pass_marks === null ? null : Number(r.pass_marks),
        exam_date: r.exam_date,
        marks_obtained: r.marks_obtained === null ? null : Number(r.marks_obtained),
        remarks: r.remarks,
        is_absent: r.is_absent,
        recorded: r.mark_id !== null,
        updated_at: r.updated_at
      });
    }

    res.status(200).json({
      student_id: studentId,
      exams: Array.from(byExam.values())
    });
  } catch (err) {
    console.error('studentExamMarks error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};
