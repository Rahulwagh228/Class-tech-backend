import type { Request, Response } from 'express';
import supabase from '../../config/connectSupabase.js';
import { daysBetween, isIsoDate, isoDateNDaysAgo, todayIsoDate } from '../../lib/dates.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_LOOKBACK_DAYS = 90;
const MAX_RANGE_DAYS = 365;

interface AttendanceRow {
  id: string;
  batch_id: string;
  attendance_date: string;
  status: string;
  notes: string | null;
  marked_by: string;
  last_edited_by: string | null;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// GET /api/v1/attendance/students/:studentId
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD  - inclusive range, max 365 days
//
// Auth:
//   - admins can view any student in their tution
//   - students can view their own history
// (Teachers go through the per-batch endpoints; we don't expose every-batch
//  history to teachers here to keep cross-batch privacy clean.)
// =============================================================================
export const studentAttendanceHistory = async (req: Request, res: Response): Promise<void> => {
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

    const studentId = req.params.studentId as string | undefined;
    if (!studentId || !UUID_RE.test(studentId)) {
      res.status(400).json({ msg: 'studentId must be a valid UUID' });
      return;
    }

    const role = req.user.role;
    if (role !== 'admin' && !(role === 'student' && req.user.id === studentId)) {
      res.status(403).json({ msg: 'Not authorized to view this history' });
      return;
    }

    // Confirm the student exists in this tution. Returns 404 instead of 403
    // when crossing tenants to avoid existence leakage.
    const { data: studentUser, error: studentErr } = await supabase
      .from('users')
      .select('id, tution_id, role')
      .eq('id', studentId)
      .eq('tution_id', tution_id)
      .eq('role', 'student')
      .maybeSingle<{ id: string; tution_id: string; role: string }>();

    if (studentErr) {
      console.error('studentAttendanceHistory: student lookup failed:', studentErr);
      res.status(500).json({ msg: 'Server error' });
      return;
    }
    if (!studentUser) {
      res.status(404).json({ msg: 'Student not found' });
      return;
    }

    const { from, to } = req.query as Record<string, string | undefined>;
    const fromDate = from ?? isoDateNDaysAgo(DEFAULT_LOOKBACK_DAYS - 1);
    const toDate = to ?? todayIsoDate();

    if (!isIsoDate(fromDate) || !isIsoDate(toDate)) {
      res.status(400).json({ msg: 'from and to must be YYYY-MM-DD' });
      return;
    }
    const span = daysBetween(fromDate, toDate);
    if (span === null) {
      res.status(400).json({ msg: 'to must be on or after from' });
      return;
    }
    if (span > MAX_RANGE_DAYS) {
      res.status(400).json({ msg: `range exceeds max of ${MAX_RANGE_DAYS} days` });
      return;
    }

    const { data: rows, error } = await supabase
      .from('attendance_records')
      .select(
        'id, batch_id, attendance_date, status, notes, marked_by, last_edited_by, created_at, updated_at'
      )
      .eq('tution_id', tution_id)
      .eq('student_id', studentId)
      .gte('attendance_date', fromDate)
      .lte('attendance_date', toDate)
      .order('attendance_date', { ascending: false });

    if (error) {
      console.error('studentAttendanceHistory: lookup failed:', error);
      res.status(500).json({ msg: 'Server error' });
      return;
    }

    const records = (rows ?? []) as AttendanceRow[];
    const batchIds = Array.from(new Set(records.map((r) => r.batch_id)));
    const batchMap = new Map<string, { id: string; name: string; code: string }>();
    if (batchIds.length > 0) {
      const { data: batches, error: batchErr } = await supabase
        .from('batches')
        .select('id, name, code')
        .eq('tution_id', tution_id)
        .in('id', batchIds);
      if (batchErr) {
        console.error('studentAttendanceHistory: batch lookup failed:', batchErr);
        res.status(500).json({ msg: 'Server error' });
        return;
      }
      for (const b of (batches ?? []) as Array<{ id: string; name: string; code: string }>) {
        batchMap.set(b.id, b);
      }
    }

    const out = records.map((r) => ({
      ...r,
      batch: batchMap.get(r.batch_id) ?? null
    }));

    res.status(200).json({
      student_id: studentId,
      from: fromDate,
      to: toDate,
      count: out.length,
      records: out
    });
  } catch (err) {
    console.error('studentAttendanceHistory error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};
