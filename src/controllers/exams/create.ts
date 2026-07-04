import type { Request, Response } from 'express';
import pool from '../../config/connectpsql.js';
import { isIsoDate } from '../../lib/dates.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SUBJECTS = 50;
const MAX_BATCHES = 100;

interface SubjectInput {
  subject: string;
  max_marks: number;
  pass_marks: number | null;
  exam_date: string | null;
}

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function nullIfEmpty(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// =============================================================================
// POST /api/v1/exams
//   admin only.
//
// Body:
// {
//   name: string,
//   code: string,
//   description?: string,
//   start_date: "YYYY-MM-DD",
//   end_date?: "YYYY-MM-DD",
//   batch_ids: string[],            // UUIDs of batches that sit for this exam
//   subjects: [                      // 1+ subjects/papers
//     { subject: string, max_marks: number, pass_marks?: number, exam_date?: "YYYY-MM-DD" }
//   ]
// }
//
// Inserts exam header, exam_batches, exam_subjects atomically. Rolls back on
// any failure.
// =============================================================================
export const createExam = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ msg: 'Authentication required' });
    return;
  }
  const tution_id = req.user.tution_id;
  if (!tution_id) {
    res.status(400).json({ msg: 'Token has no tution_id' });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;

  const name = trimString(body.name);
  const code = trimString(body.code);
  const description = nullIfEmpty(body.description);
  const start_date = trimString(body.start_date);
  const end_date_raw = body.end_date === undefined || body.end_date === null || body.end_date === ''
    ? null
    : trimString(body.end_date);

  if (!name) {
    res.status(400).json({ msg: 'name is required' });
    return;
  }
  if (!code) {
    res.status(400).json({ msg: 'code is required' });
    return;
  }
  if (!isIsoDate(start_date)) {
    res.status(400).json({ msg: 'start_date must be a valid YYYY-MM-DD date' });
    return;
  }
  if (end_date_raw !== null && !isIsoDate(end_date_raw)) {
    res.status(400).json({ msg: 'end_date must be a valid YYYY-MM-DD date' });
    return;
  }
  if (end_date_raw !== null && end_date_raw < start_date) {
    res.status(400).json({ msg: 'end_date must be on or after start_date' });
    return;
  }

  if (!Array.isArray(body.batch_ids) || body.batch_ids.length === 0) {
    res.status(400).json({ msg: 'batch_ids must be a non-empty array of UUIDs' });
    return;
  }
  if (body.batch_ids.length > MAX_BATCHES) {
    res.status(400).json({ msg: `batch_ids exceeds max of ${MAX_BATCHES}` });
    return;
  }

  const batchIdSet = new Set<string>();
  for (const value of body.batch_ids) {
    if (typeof value !== 'string' || !UUID_RE.test(value.trim())) {
      res.status(400).json({ msg: 'batch_ids must contain valid UUID strings' });
      return;
    }
    batchIdSet.add(value.trim());
  }
  const batch_ids = Array.from(batchIdSet);

  if (!Array.isArray(body.subjects) || body.subjects.length === 0) {
    res.status(400).json({ msg: 'subjects must be a non-empty array' });
    return;
  }
  if (body.subjects.length > MAX_SUBJECTS) {
    res.status(400).json({ msg: `subjects exceeds max of ${MAX_SUBJECTS}` });
    return;
  }

  const subjects: SubjectInput[] = [];
  const seenSubjects = new Set<string>();
  for (const raw of body.subjects) {
    if (typeof raw !== 'object' || raw === null) {
      res.status(400).json({ msg: 'each subject must be an object' });
      return;
    }
    const s = raw as Record<string, unknown>;

    const subject = trimString(s.subject);
    if (!subject) {
      res.status(400).json({ msg: 'each subject needs a non-empty subject name' });
      return;
    }
    const subjectKey = subject.toLowerCase();
    if (seenSubjects.has(subjectKey)) {
      res.status(400).json({ msg: `duplicate subject in payload: ${subject}` });
      return;
    }
    seenSubjects.add(subjectKey);

    const max_marks = Number(s.max_marks);
    if (!Number.isFinite(max_marks) || max_marks <= 0) {
      res.status(400).json({ msg: 'each subject needs a positive max_marks' });
      return;
    }

    let pass_marks: number | null = null;
    if (s.pass_marks !== undefined && s.pass_marks !== null && s.pass_marks !== '') {
      const pm = Number(s.pass_marks);
      if (!Number.isFinite(pm) || pm < 0 || pm > max_marks) {
        res.status(400).json({ msg: 'pass_marks must be between 0 and max_marks' });
        return;
      }
      pass_marks = pm;
    }

    let exam_date: string | null = null;
    if (s.exam_date !== undefined && s.exam_date !== null && s.exam_date !== '') {
      const ed = trimString(s.exam_date);
      if (!isIsoDate(ed)) {
        res.status(400).json({ msg: 'subject exam_date must be a valid YYYY-MM-DD date' });
        return;
      }
      exam_date = ed;
    }

    subjects.push({ subject, max_marks, pass_marks, exam_date });
  }

  const client = await pool.connect();
  try {
    // verify code is unique within this tution
    const dup = await client.query(
      `SELECT 1 FROM exams WHERE tution_id = $1 AND code = $2`,
      [tution_id, code]
    );
    if (dup.rowCount && dup.rowCount > 0) {
      res.status(409).json({ msg: 'Exam code already exists for this institution' });
      return;
    }

    // verify all batches belong to this tution
    const batchCheck = await client.query<{ id: string }>(
      `SELECT id FROM batches WHERE tution_id = $1 AND id = ANY($2::uuid[])`,
      [tution_id, batch_ids]
    );
    const foundBatchIds = new Set(batchCheck.rows.map((r) => r.id));
    const invalidBatchIds = batch_ids.filter((id) => !foundBatchIds.has(id));
    if (invalidBatchIds.length > 0) {
      res.status(400).json({
        msg: 'One or more batch_ids are invalid or do not belong to this institution',
        invalid_batch_ids: invalidBatchIds
      });
      return;
    }

    await client.query('BEGIN');

    const examInsert = await client.query<{
      id: string;
      tution_id: string;
      name: string;
      code: string;
      description: string | null;
      start_date: string;
      end_date: string | null;
      created_by: string;
      created_at: string;
    }>(
      `INSERT INTO exams (tution_id, name, code, description, start_date, end_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, tution_id, name, code, description, start_date, end_date, created_by, created_at`,
      [tution_id, name, code, description, start_date, end_date_raw, req.user.id]
    );
    const exam = examInsert.rows[0]!;

    // exam_batches
    const examBatchValues: string[] = [];
    const examBatchParams: (string | null)[] = [];
    let idx = 1;
    for (const bid of batch_ids) {
      examBatchValues.push(`($${idx++}, $${idx++}, $${idx++})`);
      examBatchParams.push(tution_id, exam.id, bid);
    }
    const examBatchesInsert = await client.query<{
      id: string;
      batch_id: string;
    }>(
      `INSERT INTO exam_batches (tution_id, exam_id, batch_id)
       VALUES ${examBatchValues.join(', ')}
       RETURNING id, batch_id`,
      examBatchParams
    );

    // exam_subjects
    const examSubjectValues: string[] = [];
    const examSubjectParams: (string | number | null)[] = [];
    idx = 1;
    for (const s of subjects) {
      examSubjectValues.push(
        `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`
      );
      examSubjectParams.push(tution_id, exam.id, s.subject, s.max_marks, s.pass_marks, s.exam_date);
    }
    const examSubjectsInsert = await client.query<{
      id: string;
      subject: string;
      max_marks: string;
      pass_marks: string | null;
      exam_date: string | null;
    }>(
      `INSERT INTO exam_subjects (tution_id, exam_id, subject, max_marks, pass_marks, exam_date)
       VALUES ${examSubjectValues.join(', ')}
       RETURNING id, subject, max_marks, pass_marks, exam_date`,
      examSubjectParams
    );

    await client.query('COMMIT');

    res.status(201).json({
      msg: 'Exam created successfully',
      exam,
      batches: examBatchesInsert.rows,
      subjects: examSubjectsInsert.rows
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('createExam error:', err);
    res.status(500).json({ msg: 'Server error' });
  } finally {
    client.release();
  }
};
