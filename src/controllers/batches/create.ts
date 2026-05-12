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

type BatchTeacherRow = {
  id: string;
  batch_id: string;
  teacher_user_id: string;
  is_lead: boolean;
  assigned_at: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

    // teacher_ids: string[] (UUIDs of teacher users). Optional - a batch can
    // be created with no teachers assigned yet. lead_teacher_id (optional)
    // must appear in teacher_ids.
    const rawTeacherIds = body.teacher_ids === undefined || body.teacher_ids === null ? [] : body.teacher_ids;
    if (!Array.isArray(rawTeacherIds)) {
      res.status(400).json({ msg: 'teacher_ids must be an array of UUID strings' });
      return;
    }
    const teacherIdSet = new Set<string>();
    for (const value of rawTeacherIds) {
      if (typeof value !== 'string') {
        res.status(400).json({ msg: 'teacher_ids must contain only non-empty strings' });
        return;
      }
      const trimmed = value.trim();
      if (!trimmed || !UUID_RE.test(trimmed)) {
        res.status(400).json({ msg: 'teacher_ids must be valid UUIDs' });
        return;
      }
      teacherIdSet.add(trimmed);
    }
    const teacher_ids = Array.from(teacherIdSet);

    let lead_teacher_id: string | null = null;
    if (body.lead_teacher_id !== undefined && body.lead_teacher_id !== null && body.lead_teacher_id !== '') {
      if (typeof body.lead_teacher_id !== 'string' || !UUID_RE.test(body.lead_teacher_id.trim())) {
        res.status(400).json({ msg: 'lead_teacher_id must be a valid UUID' });
        return;
      }
      lead_teacher_id = body.lead_teacher_id.trim();
      if (!teacherIdSet.has(lead_teacher_id)) {
        res.status(400).json({ msg: 'lead_teacher_id must also appear in teacher_ids' });
        return;
      }
    } else if (teacher_ids.length === 1) {
      // Convenience: when a batch is created with a single teacher, mark them
      // as lead automatically. Callers can override by passing lead_teacher_id.
      lead_teacher_id = teacher_ids[0]!;
    }

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

    if (teacher_ids.length > 0) {
      const { data: teacherUsers, error: teacherErr } = await supabase
        .from('users')
        .select('id')
        .eq('tution_id', tution_id)
        .eq('role', 'teacher')
        .in('id', teacher_ids);

      if (teacherErr) {
        console.error('createBatch: teacher lookup failed:', teacherErr);
        res.status(500).json({ msg: 'Server error' });
        return;
      }

      const foundTeacherIds = new Set((teacherUsers ?? []).map((t) => (t as { id: string }).id));
      const invalidTeacherIds = teacher_ids.filter((id) => !foundTeacherIds.has(id));
      if (invalidTeacherIds.length > 0) {
        res.status(400).json({
          msg: 'One or more teacher_ids are invalid or do not belong to this tution',
          invalid_teacher_ids: invalidTeacherIds
        });
        return;
      }
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
        start_date,
        end_date
      })
      .select(
        'id, tution_id, name, code, subject, description, schedule, start_date, end_date, created_at'
      )
      .single<BatchRow>();

    if (batchErr || !batch) {
      console.error('createBatch: batch insert failed:', batchErr);
      res.status(500).json({ msg: batchErr?.message ?? 'Failed to create batch' });
      return;
    }

    let assignedTeachers: BatchTeacherRow[] = [];
    if (teacher_ids.length > 0) {
      const batchTeacherRows = teacher_ids.map((tid) => ({
        tution_id,
        batch_id: batch.id,
        teacher_user_id: tid,
        is_lead: tid === lead_teacher_id
      }));

      const { data: batchTeachers, error: batchTeachersErr } = await supabase
        .from('batch_teachers')
        .insert(batchTeacherRows)
        .select('id, batch_id, teacher_user_id, is_lead, assigned_at');

      if (batchTeachersErr || !batchTeachers) {
        console.error('createBatch: batch_teachers insert failed:', batchTeachersErr);
        await supabase.from('batches').delete().eq('id', batch.id);
        res.status(500).json({
          msg: batchTeachersErr?.message ?? 'Failed to assign teachers to batch'
        });
        return;
      }

      assignedTeachers = batchTeachers as BatchTeacherRow[];
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
        // Roll back both the batch and any teacher assignments. The CASCADE
        // on batches handles batch_teachers automatically.
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
      teacher_ids,
      assigned_teachers: assignedTeachers,
      student_ids,
      enrolled_students: enrolledStudents
    });
  } catch (err) {
    console.error('createBatch error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};