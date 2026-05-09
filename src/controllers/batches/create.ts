import type { Request, Response } from 'express';
import supabase from '../../config/connectSupabase.js';

type BatchRow = {
  id: string;
  tution_id: string;
  name: string;
  code: string;
  subject: string | null;
  description: string | null;
  schedule: string | null;
  teacher_id: string | null;
  start_date: string;
  end_date: string | null;
  created_at: string;
};

type BatchStudentRow = {
  id: string;
  batch_id: string;
  student_id: string;
  joined_at: string;
};

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function nullIfEmpty(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

// =============================================================================
// POST /api/v1/batches/create
//
// Create a batch and, if provided, enroll the supplied student ids in it.
// The tenant scope comes from the JWT; the payload cannot override it.
//
// Body:
// {
//   name: string,
//   }
//
// Errors:
//   400 — missing/invalid fields
//   401 — not authenticated
//   403 — caller lacks permission
//   409 — batch code already exists
//   500 — server error
// =============================================================================
export const createBatch = async (req: Request, res: Response): Promise<void> => {
  try {
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
    const subject = nullIfEmpty(body.subject);
    const description = nullIfEmpty(body.description);
    const schedule = nullIfEmpty(body.schedule);
    const teacher_id =
      body.teacher_id === undefined || body.teacher_id === null || body.teacher_id === ''
        ? null
        : trimString(body.teacher_id);

    let start_date = todayIsoDate();
    if (body.start_date !== undefined && body.start_date !== null && body.start_date !== '') {
      if (typeof body.start_date !== 'string' || !isIsoDate(body.start_date.trim())) {
        res.status(400).json({ msg: 'start_date must be a valid YYYY-MM-DD date' });
        return;
      }
      start_date = body.start_date.trim();
    }

    let end_date: string | null = null;
    if (body.end_date !== undefined && body.end_date !== null && body.end_date !== '') {
      if (typeof body.end_date !== 'string' || !isIsoDate(body.end_date.trim())) {
        res.status(400).json({ msg: 'end_date must be a valid YYYY-MM-DD date' });
        return;
      }
      end_date = body.end_date.trim();
    }

    if (body.teacher_id !== undefined && body.teacher_id !== null && typeof body.teacher_id !== 'string') {
      res.status(400).json({ msg: 'teacher_id must be a string or null' });
      return;
    }

    const rawStudentIds =
      body.student_ids === undefined || body.student_ids === null ? [] : body.student_ids;
    if (!Array.isArray(rawStudentIds)) {
      res.status(400).json({ msg: 'student_ids must be an array of strings' });
      return;
    }

    const studentIdSet = new Set<string>();
    for (const value of rawStudentIds) {
      if (typeof value !== 'string') {
        res.status(400).json({ msg: 'student_ids must contain only non-empty strings' });
        return;
      }

      const trimmedValue = value.trim();
      if (!trimmedValue) {
        res.status(400).json({ msg: 'student_ids must contain only non-empty strings' });
        return;
      }

      studentIdSet.add(trimmedValue);
    }

    const student_ids = Array.from(studentIdSet);

    if (subject === null && body.subject !== undefined && body.subject !== null && typeof body.subject !== 'string') {
      res.status(400).json({ msg: 'subject must be a string or null' });
      return;
    }
    if (
      description === null &&
      body.description !== undefined &&
      body.description !== null &&
      typeof body.description !== 'string'
    ) {
      res.status(400).json({ msg: 'description must be a string or null' });
      return;
    }
    if (
      schedule === null &&
      body.schedule !== undefined &&
      body.schedule !== null &&
      typeof body.schedule !== 'string'
    ) {
      res.status(400).json({ msg: 'schedule must be a string or null' });
      return;
    }

    if (!name) {
      res.status(400).json({ msg: 'name is required' });
      return;
    }
    if (!code) {
      res.status(400).json({ msg: 'code is required' });
      return;
    }
    if (end_date && end_date < start_date) {
      res.status(400).json({ msg: 'end_date must be on or after start_date' });
      return;
    }

    const { data: existingBatch, error: existingBatchErr } = await supabase
      .from('batches')
      .select('id')
      .eq('code', code)
      .maybeSingle();

    if (existingBatchErr) {
      console.error('createBatch: batch lookup failed:', existingBatchErr);
      res.status(500).json({ msg: 'Server error' });
      return;
    }

    if (existingBatch) {
      res.status(409).json({ msg: 'Batch code already exists' });
      return;
    }

    let resolvedTeacherId: string | null = null;
    if (teacher_id) {
      const { data: teacherUser, error: teacherErr } = await supabase
        .from('users')
        .select('id')
        .eq('id', teacher_id)
        .eq('tution_id', tution_id)
        .eq('role', 'teacher')
        .maybeSingle();

      if (teacherErr) {
        console.error('createBatch: teacher lookup failed:', teacherErr);
        res.status(500).json({ msg: 'Server error' });
        return;
      }

      if (!teacherUser) {
        res.status(400).json({
          msg: 'teacher_id must reference a teacher in this tution'
        });
        return;
      }

      resolvedTeacherId = teacherUser.id;
    }

    let enrolledStudents: BatchStudentRow[] = [];
    if (student_ids.length > 0) {
      const { data: studentUsers, error: studentErr } = await supabase
        .from('users')
        .select('id')
        .eq('tution_id', tution_id)
        .eq('role', 'student')
        .in('id', student_ids);

      if (studentErr) {
        console.error('createBatch: student lookup failed:', studentErr);
        res.status(500).json({ msg: 'Server error' });
        return;
      }

      const foundStudentIds = new Set((studentUsers ?? []).map((student) => student.id));
      const invalidStudentIds = student_ids.filter((studentId) => !foundStudentIds.has(studentId));

      if (invalidStudentIds.length > 0) {
        res.status(400).json({
          msg: 'One or more student_ids are invalid or do not belong to this tution',
          invalid_student_ids: invalidStudentIds
        });
        return;
      }
    }

    const { data: batch, error: batchErr } = await supabase
      .from('batches')
      .insert({
        tution_id,
        name,
        code,
        subject,
        description,
        schedule,
        teacher_id: resolvedTeacherId,
        start_date,
        end_date
      })
      .select(
        'id, tution_id, name, code, subject, description, schedule, teacher_id, start_date, end_date, created_at'
      )
      .single<BatchRow>();

    if (batchErr || !batch) {
      console.error('createBatch: batch insert failed:', batchErr);
      res.status(500).json({ msg: batchErr?.message ?? 'Failed to create batch' });
      return;
    }

    if (student_ids.length > 0) {
      const batchStudentRows = student_ids.map((studentId) => ({
        batch_id: batch.id,
        student_id: studentId
      }));

      const { data: batchStudents, error: batchStudentsErr } = await supabase
        .from('batch_students')
        .insert(batchStudentRows)
        .select('id, batch_id, student_id, joined_at');

      if (batchStudentsErr || !batchStudents) {
        console.error('createBatch: batch_students insert failed:', batchStudentsErr);
        await supabase.from('batches').delete().eq('id', batch.id);
        res.status(500).json({
          msg: batchStudentsErr?.message ?? 'Failed to add students to batch'
        });
        return;
      }

      enrolledStudents = batchStudents as BatchStudentRow[];
    }

    res.status(201).json({
      msg: 'Batch created successfully',
      batch,
      student_ids,
      enrolled_students: enrolledStudents
    });
  } catch (err) {
    console.error('createBatch error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};