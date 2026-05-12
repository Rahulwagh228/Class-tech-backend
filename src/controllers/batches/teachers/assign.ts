import type { Request, Response } from 'express';
import supabase from '../../../config/connectSupabase.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BULK = 50;

interface BatchTeacherRow {
  id: string;
  batch_id: string;
  teacher_user_id: string;
  is_lead: boolean;
  assigned_at: string;
}

// =============================================================================
// POST /api/v1/batches/:batchId/teachers
//
// Admin-only. Assigns one or more teachers to a batch. Idempotent on
// teacher_id: re-posting an already-assigned teacher updates the row's
// is_lead flag (or leaves it alone if not supplied) and does NOT duplicate.
//
// Body:
// {
//   "teacher_ids": ["uuid-a", "uuid-b"],
//   "lead_teacher_id": "uuid-a"     // optional. Must be in teacher_ids or
//                                   // already assigned. When provided, this
//                                   // teacher becomes the sole lead - all
//                                   // other links in the batch are demoted.
// }
//
// Response: 200
// {
//   "msg": "Teachers assigned",
//   "batch_id": "...",
//   "assigned": N,            // newly inserted
//   "already_assigned": M,    // were already linked
//   "lead_teacher_id": "...", // null when not set
//   "teachers": [BatchTeacherRow...]
// }
// =============================================================================
export const assignBatchTeachers = async (req: Request, res: Response): Promise<void> => {
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

    const batchId = req.params.batchId as string | undefined;
    if (!batchId || !UUID_RE.test(batchId)) {
      res.status(400).json({ msg: 'batchId must be a valid UUID' });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;

    if (!Array.isArray(body.teacher_ids) || body.teacher_ids.length === 0) {
      res.status(400).json({ msg: 'teacher_ids must be a non-empty array' });
      return;
    }
    if (body.teacher_ids.length > MAX_BULK) {
      res.status(400).json({ msg: `teacher_ids exceeds max of ${MAX_BULK}` });
      return;
    }

    const teacherIdSet = new Set<string>();
    for (const value of body.teacher_ids) {
      if (typeof value !== 'string' || !UUID_RE.test(value.trim())) {
        res.status(400).json({ msg: 'each teacher_id must be a valid UUID' });
        return;
      }
      teacherIdSet.add(value.trim());
    }
    const teacher_ids = Array.from(teacherIdSet);

    let lead_teacher_id: string | null = null;
    if (body.lead_teacher_id !== undefined && body.lead_teacher_id !== null && body.lead_teacher_id !== '') {
      if (typeof body.lead_teacher_id !== 'string' || !UUID_RE.test(body.lead_teacher_id.trim())) {
        res.status(400).json({ msg: 'lead_teacher_id must be a valid UUID' });
        return;
      }
      lead_teacher_id = body.lead_teacher_id.trim();
    }

    // Verify batch belongs to caller's tution.
    const { data: batch, error: batchErr } = await supabase
      .from('batches')
      .select('id, tution_id')
      .eq('id', batchId)
      .eq('tution_id', tution_id)
      .maybeSingle<{ id: string; tution_id: string }>();
    if (batchErr) {
      console.error('assignBatchTeachers: batch lookup failed:', batchErr);
      res.status(500).json({ msg: 'Server error' });
      return;
    }
    if (!batch) {
      res.status(404).json({ msg: 'Batch not found' });
      return;
    }

    // Verify all teacher_ids are real teachers in this tution.
    const { data: teacherUsers, error: teacherErr } = await supabase
      .from('users')
      .select('id')
      .eq('tution_id', tution_id)
      .eq('role', 'teacher')
      .in('id', teacher_ids);
    if (teacherErr) {
      console.error('assignBatchTeachers: teacher lookup failed:', teacherErr);
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

    // Find which teachers are already assigned.
    const { data: existing, error: existingErr } = await supabase
      .from('batch_teachers')
      .select('teacher_user_id')
      .eq('batch_id', batch.id)
      .in('teacher_user_id', teacher_ids);
    if (existingErr) {
      console.error('assignBatchTeachers: existing lookup failed:', existingErr);
      res.status(500).json({ msg: 'Server error' });
      return;
    }
    const existingSet = new Set((existing ?? []).map((r) => (r as { teacher_user_id: string }).teacher_user_id));
    const toInsert = teacher_ids.filter((id) => !existingSet.has(id));

    // lead_teacher_id, when provided, must be in teacher_ids (i.e. either
    // newly assigned or already assigned and now being explicitly set as lead).
    if (lead_teacher_id && !teacherIdSet.has(lead_teacher_id)) {
      res.status(400).json({ msg: 'lead_teacher_id must also appear in teacher_ids' });
      return;
    }

    if (toInsert.length > 0) {
      const rows = toInsert.map((tid) => ({
        tution_id,
        batch_id: batch.id,
        teacher_user_id: tid,
        is_lead: tid === lead_teacher_id
      }));
      const { error: insertErr } = await supabase.from('batch_teachers').insert(rows);
      if (insertErr) {
        console.error('assignBatchTeachers: insert failed:', insertErr);
        res.status(500).json({ msg: insertErr.message ?? 'Failed to assign teachers' });
        return;
      }
    }

    // Lead-flip semantics: when lead_teacher_id is provided, that teacher
    // becomes the SOLE lead in the batch. Demote everyone else first, then
    // promote.
    if (lead_teacher_id) {
      const { error: demoteErr } = await supabase
        .from('batch_teachers')
        .update({ is_lead: false })
        .eq('batch_id', batch.id)
        .neq('teacher_user_id', lead_teacher_id);
      if (demoteErr) {
        console.error('assignBatchTeachers: demote failed:', demoteErr);
        res.status(500).json({ msg: 'Server error' });
        return;
      }
      const { error: promoteErr } = await supabase
        .from('batch_teachers')
        .update({ is_lead: true })
        .eq('batch_id', batch.id)
        .eq('teacher_user_id', lead_teacher_id);
      if (promoteErr) {
        console.error('assignBatchTeachers: promote failed:', promoteErr);
        res.status(500).json({ msg: 'Server error' });
        return;
      }
    }

    const { data: finalRows, error: finalErr } = await supabase
      .from('batch_teachers')
      .select('id, batch_id, teacher_user_id, is_lead, assigned_at')
      .eq('batch_id', batch.id)
      .order('is_lead', { ascending: false })
      .order('assigned_at', { ascending: true });

    if (finalErr) {
      console.error('assignBatchTeachers: final lookup failed:', finalErr);
      res.status(500).json({ msg: 'Server error' });
      return;
    }

    res.status(200).json({
      msg: 'Teachers assigned',
      batch_id: batch.id,
      assigned: toInsert.length,
      already_assigned: existingSet.size,
      lead_teacher_id,
      teachers: (finalRows ?? []) as BatchTeacherRow[]
    });
  } catch (err) {
    console.error('assignBatchTeachers error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};
