import type { Request, Response } from 'express';
import supabase from '../../config/connectSupabase.js';
import { ATTENDANCE_STATUSES, type AttendanceStatus } from './mark.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AttendanceRow {
  id: string;
  tution_id: string;
  batch_id: string;
  student_id: string;
  attendance_date: string;
  status: AttendanceStatus;
  notes: string | null;
  marked_by: string;
  last_edited_by: string | null;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// PATCH /api/v1/attendance/:recordId
//
// Edit a single attendance row. Only the assigned teacher of the batch (or an
// admin in the same tution) may edit. We don't go through requireBatchAccess
// because the batchId isn't in the URL - we load the record first and then
// apply the same checks.
//
// Body: { status?: AttendanceStatus, notes?: string | null }
// =============================================================================
export const updateAttendance = async (req: Request, res: Response): Promise<void> => {
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

    const recordId = req.params.recordId as string | undefined;
    if (!recordId || !UUID_RE.test(recordId)) {
      res.status(400).json({ msg: 'recordId must be a valid UUID' });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Partial<{ status: AttendanceStatus; notes: string | null }> = {};

    if (body.status !== undefined) {
      const status = typeof body.status === 'string' ? body.status.trim() : '';
      if (!ATTENDANCE_STATUSES.includes(status as AttendanceStatus)) {
        res.status(400).json({
          msg: `status must be one of ${ATTENDANCE_STATUSES.join(', ')}`
        });
        return;
      }
      patch.status = status as AttendanceStatus;
    }

    if (body.notes !== undefined) {
      if (body.notes === null) {
        patch.notes = null;
      } else if (typeof body.notes === 'string') {
        const trimmed = body.notes.trim();
        patch.notes = trimmed.length > 0 ? trimmed : null;
      } else {
        res.status(400).json({ msg: 'notes must be a string or null' });
        return;
      }
    }

    if (Object.keys(patch).length === 0) {
      res.status(400).json({ msg: 'At least one of status or notes must be provided' });
      return;
    }

    const { data: existing, error: existingErr } = await supabase
      .from('attendance_records')
      .select('id, tution_id, batch_id, student_id')
      .eq('id', recordId)
      .eq('tution_id', tution_id)
      .maybeSingle<{ id: string; tution_id: string; batch_id: string; student_id: string }>();

    if (existingErr) {
      console.error('updateAttendance: lookup failed:', existingErr);
      res.status(500).json({ msg: 'Server error' });
      return;
    }
    if (!existing) {
      res.status(404).json({ msg: 'Attendance record not found' });
      return;
    }

    const { data: batch, error: batchErr } = await supabase
      .from('batches')
      .select('id, teacher_id, tution_id')
      .eq('id', existing.batch_id)
      .eq('tution_id', tution_id)
      .maybeSingle<{ id: string; teacher_id: string | null; tution_id: string }>();

    if (batchErr) {
      console.error('updateAttendance: batch lookup failed:', batchErr);
      res.status(500).json({ msg: 'Server error' });
      return;
    }
    if (!batch) {
      res.status(404).json({ msg: 'Attendance record not found' });
      return;
    }

    const role = req.user.role;
    const isAdmin = role === 'admin';
    const isOwningTeacher = role === 'teacher' && batch.teacher_id === req.user.id;
    if (!isAdmin && !isOwningTeacher) {
      res.status(403).json({ msg: 'Not authorized to edit this record' });
      return;
    }

    const { data: updated, error: updateErr } = await supabase
      .from('attendance_records')
      .update({
        ...patch,
        last_edited_by: req.user.id,
        updated_at: new Date().toISOString()
      })
      .eq('id', recordId)
      .eq('tution_id', tution_id)
      .select(
        'id, tution_id, batch_id, student_id, attendance_date, status, notes, marked_by, last_edited_by, created_at, updated_at'
      )
      .single<AttendanceRow>();

    if (updateErr || !updated) {
      console.error('updateAttendance: update failed:', updateErr);
      res.status(500).json({ msg: updateErr?.message ?? 'Failed to update attendance' });
      return;
    }

    res.status(200).json({ msg: 'Attendance updated', record: updated });
  } catch (err) {
    console.error('updateAttendance error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};
