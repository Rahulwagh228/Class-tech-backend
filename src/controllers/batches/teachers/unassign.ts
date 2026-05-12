import type { Request, Response } from 'express';
import supabase from '../../../config/connectSupabase.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// =============================================================================
// DELETE /api/v1/batches/:batchId/teachers/:teacherId
//
// Admin-only. Removes a teacher from a batch. Attendance rows the teacher
// previously marked are NOT touched - marked_by stays as the original
// teacher's id to preserve the audit trail.
// =============================================================================
export const unassignBatchTeacher = async (req: Request, res: Response): Promise<void> => {
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
    const teacherId = req.params.teacherId as string | undefined;
    if (!batchId || !UUID_RE.test(batchId)) {
      res.status(400).json({ msg: 'batchId must be a valid UUID' });
      return;
    }
    if (!teacherId || !UUID_RE.test(teacherId)) {
      res.status(400).json({ msg: 'teacherId must be a valid UUID' });
      return;
    }

    // Verify batch is in caller's tution.
    const { data: batch, error: batchErr } = await supabase
      .from('batches')
      .select('id')
      .eq('id', batchId)
      .eq('tution_id', tution_id)
      .maybeSingle<{ id: string }>();
    if (batchErr) {
      console.error('unassignBatchTeacher: batch lookup failed:', batchErr);
      res.status(500).json({ msg: 'Server error' });
      return;
    }
    if (!batch) {
      res.status(404).json({ msg: 'Batch not found' });
      return;
    }

    const { data: deleted, error } = await supabase
      .from('batch_teachers')
      .delete()
      .eq('batch_id', batchId)
      .eq('teacher_user_id', teacherId)
      .select('id, teacher_user_id, is_lead')
      .maybeSingle<{ id: string; teacher_user_id: string; is_lead: boolean }>();

    if (error) {
      console.error('unassignBatchTeacher: delete failed:', error);
      res.status(500).json({ msg: 'Server error' });
      return;
    }
    if (!deleted) {
      res.status(404).json({ msg: 'Teacher is not assigned to this batch' });
      return;
    }

    res.status(200).json({
      msg: 'Teacher unassigned',
      batch_id: batchId,
      teacher_id: teacherId,
      was_lead: deleted.is_lead
    });
  } catch (err) {
    console.error('unassignBatchTeacher error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};
