import type { Request, Response } from 'express';
import pool from '../../../config/connectpsql.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BULK_RECORDS = 500;

interface MarkRecordInput {
  student_id: string;
  marks_obtained: number;
  remarks: string | null;
  is_absent: boolean;
}

// =============================================================================
// POST /api/v1/exams/:examId/marks
//   admin OR teacher assigned to one of the exam's batches.
//
// Bulk-upsert marks for ONE subject of an exam. Idempotent on
// (exam_subject_id, student_id) - re-posting updates and bumps
// last_edited_by + updated_at, preserving the original recorded_by.
//
// Body:
// {
//   exam_subject_id: "uuid",
//   records: [
//     { student_id: "uuid", marks_obtained: number, remarks?: string, is_absent?: boolean }
//   ]
// }
//
// Validation:
//   - exam_subject_id must belong to req.exam.id
//   - marks_obtained must be 0..max_marks; if is_absent=true, force to 0
//   - each student_id must be enrolled in one of the exam's batches
//
// Response: { created, updated, records: [...] }
// =============================================================================
export const upsertExamMarks = async (req: Request, res: Response): Promise<void> => {
  if (!req.user || !req.exam) {
    res.status(401).json({ msg: 'Authentication required' });
    return;
  }

  const tution_id = req.user.tution_id;
  const exam_id = req.exam.id;
  const body = (req.body ?? {}) as Record<string, unknown>;

  const examSubjectId = typeof body.exam_subject_id === 'string' ? body.exam_subject_id.trim() : '';
  if (!examSubjectId || !UUID_RE.test(examSubjectId)) {
    res.status(400).json({ msg: 'exam_subject_id must be a valid UUID' });
    return;
  }

  if (!Array.isArray(body.records) || body.records.length === 0) {
    res.status(400).json({ msg: 'records must be a non-empty array' });
    return;
  }
  if (body.records.length > MAX_BULK_RECORDS) {
    res.status(400).json({ msg: `records exceeds max of ${MAX_BULK_RECORDS}` });
    return;
  }

  const records: MarkRecordInput[] = [];
  const seen = new Set<string>();
  for (const raw of body.records) {
    if (typeof raw !== 'object' || raw === null) {
      res.status(400).json({ msg: 'each record must be an object' });
      return;
    }
    const r = raw as Record<string, unknown>;

    const sid = typeof r.student_id === 'string' ? r.student_id.trim() : '';
    if (!sid || !UUID_RE.test(sid)) {
      res.status(400).json({ msg: 'each record needs a valid student_id (UUID)' });
      return;
    }
    if (seen.has(sid)) {
      res.status(400).json({ msg: `duplicate student_id in records: ${sid}` });
      return;
    }
    seen.add(sid);

    const is_absent = r.is_absent === true;
    let marks_obtained = 0;
    if (!is_absent) {
      const m = Number(r.marks_obtained);
      if (!Number.isFinite(m) || m < 0) {
        res.status(400).json({ msg: 'marks_obtained must be a non-negative number' });
        return;
      }
      marks_obtained = m;
    }

    let remarks: string | null = null;
    if (r.remarks !== undefined && r.remarks !== null) {
      if (typeof r.remarks !== 'string') {
        res.status(400).json({ msg: 'remarks must be a string or null' });
        return;
      }
      const trimmed = r.remarks.trim();
      remarks = trimmed.length > 0 ? trimmed : null;
    }

    records.push({ student_id: sid, marks_obtained, remarks, is_absent });
  }

  const client = await pool.connect();
  try {
    // 1. exam_subject must exist under this exam
    const subjRes = await client.query<{ id: string; max_marks: string }>(
      `SELECT id, max_marks FROM exam_subjects WHERE id = $1 AND exam_id = $2 AND tution_id = $3`,
      [examSubjectId, exam_id, tution_id]
    );
    const subject = subjRes.rows[0];
    if (!subject) {
      res.status(404).json({ msg: 'exam_subject_id does not belong to this exam' });
      return;
    }
    const maxMarks = Number(subject.max_marks);

    // 2. enforce upper bound per record
    for (const rec of records) {
      if (rec.marks_obtained > maxMarks) {
        res.status(400).json({
          msg: `marks_obtained for student ${rec.student_id} exceeds subject max_marks (${maxMarks})`
        });
        return;
      }
    }

    // 3. every student must be enrolled in at least one batch participating in this exam
    const studentIds = records.map((r) => r.student_id);
    const enrolledRes = await client.query<{ student_id: string }>(
      `SELECT DISTINCT bs.student_id
         FROM batch_students bs
         JOIN exam_batches eb ON eb.batch_id = bs.batch_id
        WHERE eb.exam_id = $1
          AND bs.student_id = ANY($2::uuid[])`,
      [exam_id, studentIds]
    );
    const enrolledSet = new Set(enrolledRes.rows.map((r) => r.student_id));
    const missing = studentIds.filter((id) => !enrolledSet.has(id));
    if (missing.length > 0) {
      res.status(400).json({
        msg: 'One or more students are not enrolled in any batch of this exam',
        not_enrolled_student_ids: missing
      });
      return;
    }

    // 4. determine which already exist to report created vs updated and preserve recorded_by
    const existingRes = await client.query<{ student_id: string }>(
      `SELECT student_id FROM exam_marks
        WHERE exam_subject_id = $1 AND student_id = ANY($2::uuid[])`,
      [examSubjectId, studentIds]
    );
    const existingSet = new Set(existingRes.rows.map((r) => r.student_id));

    // 5. build a single INSERT ... ON CONFLICT DO UPDATE
    const values: string[] = [];
    const params: (string | number | boolean | null)[] = [];
    let idx = 1;
    for (const r of records) {
      values.push(
        `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`
      );
      params.push(
        tution_id,
        exam_id,
        examSubjectId,
        r.student_id,
        r.marks_obtained,
        r.remarks,
        r.is_absent,
        req.user.id
      );
    }

    await client.query('BEGIN');

    const upsertRes = await client.query(
      `INSERT INTO exam_marks
         (tution_id, exam_id, exam_subject_id, student_id,
          marks_obtained, remarks, is_absent, recorded_by)
       VALUES ${values.join(', ')}
       ON CONFLICT (exam_subject_id, student_id) DO UPDATE
         SET marks_obtained = EXCLUDED.marks_obtained,
             remarks        = EXCLUDED.remarks,
             is_absent      = EXCLUDED.is_absent,
             last_edited_by = EXCLUDED.recorded_by,
             updated_at     = NOW()
       RETURNING id, tution_id, exam_id, exam_subject_id, student_id,
                 marks_obtained, remarks, is_absent,
                 recorded_by, last_edited_by, created_at, updated_at`,
      params
    );

    await client.query('COMMIT');

    const updated = existingSet.size;
    const created = records.length - updated;

    res.status(200).json({
      msg: 'Marks recorded',
      created,
      updated,
      records: upsertRes.rows
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('upsertExamMarks error:', err);
    res.status(500).json({ msg: 'Server error' });
  } finally {
    client.release();
  }
};
