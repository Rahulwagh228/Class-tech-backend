import type { Request, Response } from 'express';
import supabase from '../../config/connectSupabase.js';
import { daysBetween, isIsoDate } from '../../lib/dates.js';

const MAX_RANGE_DAYS = 90;

interface AttendanceRow {
  id: string;
  batch_id: string;
  student_id: string;
  attendance_date: string;
  status: string;
  notes: string | null;
  marked_by: string;
  last_edited_by: string | null;
  created_at: string;
  updated_at: string;
}

interface StudentUserRow {
  id: string;
  name: string;
  username: string;
  profile_photo: string | null;
}

interface StudentProfileRow {
  user_id: string;
  enrollment_number: string;
}

// =============================================================================
// GET /api/v1/attendance/batches/:batchId
//   ?date=YYYY-MM-DD  - single day
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD  - inclusive range, max 90 days
//
// requireBatchAccess has already validated tenant + ownership.
// =============================================================================
export const listAttendance = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user || !req.batch) {
      res.status(401).json({ msg: 'Authentication required' });
      return;
    }

    const tution_id = req.user.tution_id;
    const batch_id = req.batch.id;
    const { date, from, to } = req.query as Record<string, string | undefined>;

    let query = supabase
      .from('attendance_records')
      .select(
        'id, batch_id, student_id, attendance_date, status, notes, marked_by, last_edited_by, created_at, updated_at'
      )
      .eq('tution_id', tution_id)
      .eq('batch_id', batch_id);

    if (date) {
      if (!isIsoDate(date)) {
        res.status(400).json({ msg: 'date must be YYYY-MM-DD' });
        return;
      }
      query = query.eq('attendance_date', date);
    } else if (from || to) {
      if (!from || !to) {
        res.status(400).json({ msg: 'from and to must both be provided' });
        return;
      }
      if (!isIsoDate(from) || !isIsoDate(to)) {
        res.status(400).json({ msg: 'from and to must be YYYY-MM-DD' });
        return;
      }
      const span = daysBetween(from, to);
      if (span === null) {
        res.status(400).json({ msg: 'to must be on or after from' });
        return;
      }
      if (span > MAX_RANGE_DAYS) {
        res.status(400).json({ msg: `range exceeds max of ${MAX_RANGE_DAYS} days` });
        return;
      }
      query = query.gte('attendance_date', from).lte('attendance_date', to);
    }

    const { data: rows, error } = await query
      .order('attendance_date', { ascending: false })
      .order('student_id', { ascending: true });

    if (error) {
      console.error('listAttendance: lookup failed:', error);
      res.status(500).json({ msg: 'Server error' });
      return;
    }

    const records = (rows ?? []) as AttendanceRow[];
    const studentIds = Array.from(new Set(records.map((r) => r.student_id)));

    const studentMap = new Map<string, { name: string; username: string; profile_photo: string | null }>();
    const enrollmentMap = new Map<string, string>();

    if (studentIds.length > 0) {
      const [{ data: users, error: usersErr }, { data: profiles, error: profilesErr }] = await Promise.all([
        supabase
          .from('users')
          .select('id, name, username, profile_photo')
          .eq('tution_id', tution_id)
          .in('id', studentIds),
        supabase
          .from('students')
          .select('user_id, enrollment_number')
          .eq('tution_id', tution_id)
          .in('user_id', studentIds)
      ]);

      if (usersErr) {
        console.error('listAttendance: users lookup failed:', usersErr);
        res.status(500).json({ msg: 'Server error' });
        return;
      }
      if (profilesErr) {
        console.error('listAttendance: students lookup failed:', profilesErr);
        res.status(500).json({ msg: 'Server error' });
        return;
      }

      for (const u of (users ?? []) as StudentUserRow[]) {
        studentMap.set(u.id, { name: u.name, username: u.username, profile_photo: u.profile_photo });
      }
      for (const p of (profiles ?? []) as StudentProfileRow[]) {
        enrollmentMap.set(p.user_id, p.enrollment_number);
      }
    }

    const out = records.map((r) => ({
      ...r,
      student: studentMap.get(r.student_id)
        ? {
            id: r.student_id,
            ...studentMap.get(r.student_id)!,
            enrollment_number: enrollmentMap.get(r.student_id) ?? null
          }
        : null
    }));

    res.status(200).json({ count: out.length, records: out });
  } catch (err) {
    console.error('listAttendance error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};
