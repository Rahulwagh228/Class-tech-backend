import type { Request, Response } from 'express';
import supabase from '../../config/connectSupabase.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// =============================================================================
// DELETE /api/v1/attendance/:recordId
//
// Hard-delete a single attendance row. Admin-only. Tenant-scoped.
// =============================================================================
export const removeAttendance = async (req: Request, res: Response): Promise<void> => {
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

    const { data: deleted, error } = await supabase
      .from('attendance_records')
      .delete()
      .eq('id', recordId)
      .eq('tution_id', tution_id)
      .select('id')
      .maybeSingle<{ id: string }>();

    if (error) {
      console.error('removeAttendance: delete failed:', error);
      res.status(500).json({ msg: 'Server error' });
      return;
    }
    if (!deleted) {
      res.status(404).json({ msg: 'Attendance record not found' });
      return;
    }

    res.status(200).json({ msg: 'Attendance record deleted', id: deleted.id });
  } catch (err) {
    console.error('removeAttendance error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};
