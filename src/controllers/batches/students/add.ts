import type { Request, Response } from 'express';
import supabase from '../../../config/connectSupabase.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type BatchStudentRow = {
  id: string;
  batch_id: string;
  student_id: string;
  joined_at: string;
};

// =============================================================================
// POST /api/v1/batches/:batchId/students
//
// Add one or more students to an existing batch. Idempotent: students already
// enrolled are reported under `already_enrolled` rather than erroring.
//
// Auth: admin OR a teacher assigned to this batch (enforced by
//       requireBatchAccess - that middleware also attaches req.batch).
//
// Body:
//   { student_ids: ["uuid", "uuid", ...] }
//
// Response 200/201:
//   {
//     msg, batch_id,
//     added:            [ {id, batch_id, student_id, joined_at}, ... ],
//     already_enrolled: [ "uuid", ... ],
//   }
//
// Errors:
//   400 — body invalid; student_ids missing/empty/malformed; or any id
//         doesn't belong to a student in this tution
//   404 — batch not found / wrong tenant  (from requireBatchAccess)
//   500 — server error
// =============================================================================
export const addStudentsToBatch = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ msg: 'Authentication required' });
      return;
    }
    const tution_id = req.user.tution_id;
    const batch = req.batch;
    if (!batch) {
      // Defensive - requireBatchAccess should always set this.
      res.status(500).json({ msg: 'Batch context missing' });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const raw = body.student_ids;

    if (!Array.isArray(raw) || raw.length === 0) {
      res.status(400).json({ msg: 'student_ids must be a non-empty array of UUID strings' });
      return;
    }

    // Validate + dedupe
    const idSet = new Set<string>();
    for (const value of raw) {
      if (typeof value !== 'string') {
        res.status(400).json({ msg: 'student_ids must contain only strings' });
        return;
      }
      const trimmed = value.trim();
      if (!UUID_RE.test(trimmed)) {
        res.status(400).json({ msg: `student_ids contains an invalid UUID: ${trimmed}` });
        return;
      }
      idSet.add(trimmed);
    }
    const student_ids = Array.from(idSet);

    // Verify every id is actually a student in this tution.
    const { data: validStudents, error: studentLookupErr } = await supabase
      .from('users')
      .select('id')
      .eq('tution_id', tution_id)
      .eq('role', 'student')
      .in('id', student_ids);

    if (studentLookupErr) {
      console.error('addStudentsToBatch: student lookup failed:', studentLookupErr);
      res.status(500).json({ msg: 'Server error' });
      return;
    }

    const validIds = new Set((validStudents ?? []).map((r) => (r as { id: string }).id));
    const invalidIds = student_ids.filter((id) => !validIds.has(id));
    if (invalidIds.length > 0) {
      res.status(400).json({
        msg: 'One or more student_ids are invalid or do not belong to this tution',
        invalid_student_ids: invalidIds
      });
      return;
    }

    // Figure out who's already enrolled so the insert is idempotent.
    const { data: existing, error: existingErr } = await supabase
      .from('batch_students')
      .select('student_id')
      .eq('batch_id', batch.id)
      .in('student_id', student_ids);

    if (existingErr) {
      console.error('addStudentsToBatch: existing enrollment lookup failed:', existingErr);
      res.status(500).json({ msg: 'Server error' });
      return;
    }

    const alreadyEnrolled = new Set(
      (existing ?? []).map((r) => (r as { student_id: string }).student_id)
    );
    const toInsert = student_ids.filter((id) => !alreadyEnrolled.has(id));

    if (toInsert.length === 0) {
      res.status(200).json({
        msg: 'All supplied students were already enrolled in this batch',
        batch_id: batch.id,
        added: [],
        already_enrolled: Array.from(alreadyEnrolled)
      });
      return;
    }

    const rows = toInsert.map((student_id) => ({
      batch_id: batch.id,
      student_id
    }));

    const { data: added, error: insertErr } = await supabase
      .from('batch_students')
      .insert(rows)
      .select('id, batch_id, student_id, joined_at');

    if (insertErr || !added) {
      console.error('addStudentsToBatch: insert failed:', insertErr);
      res.status(500).json({ msg: insertErr?.message ?? 'Failed to add students to batch' });
      return;
    }

    res.status(201).json({
      msg: 'Students added to batch',
      batch_id: batch.id,
      added: added as BatchStudentRow[],
      already_enrolled: Array.from(alreadyEnrolled)
    });
  } catch (err) {
    console.error('addStudentsToBatch error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};
