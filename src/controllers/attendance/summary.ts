import type { Request, Response } from 'express';
import supabase from '../../config/connectSupabase.js';
import { daysBetween, isIsoDate, isoDateNDaysAgo, todayIsoDate } from '../../lib/dates.js';

const DEFAULT_LOOKBACK_DAYS = 30;
const MAX_RANGE_DAYS = 365;

interface AttendanceRow {
  student_id: string;
  status: 'present' | 'absent' | 'late' | 'excused';
}

interface StudentUserRow {
  id: string;
  name: string;
  username: string;
}

interface StudentProfileRow {
  user_id: string;
  enrollment_number: string;
}

// =============================================================================
// GET /api/v1/attendance/batches/:batchId/summary
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD  - inclusive range, max 365 days
//   defaults to the last 30 days when both are omitted
//
// Returns per-student counts by status and an attendance percentage.
//
// Percentage formula:
//   present / (present + absent + late)
// 'excused' is intentionally excluded from the denominator - excused absences
// shouldn't count against a student. Document this any time the formula is
// argued about.
// =============================================================================
export const attendanceSummary = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user || !req.batch) {
      res.status(401).json({ msg: 'Authentication required' });
      return;
    }

    const tution_id = req.user.tution_id;
    const batch_id = req.batch.id;
    const { from, to } = req.query as Record<string, string | undefined>;

    const today = todayIsoDate();
    const fromDate = from ?? isoDateNDaysAgo(DEFAULT_LOOKBACK_DAYS - 1);
    const toDate = to ?? today;

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
      .select('student_id, status')
      .eq('tution_id', tution_id)
      .eq('batch_id', batch_id)
      .gte('attendance_date', fromDate)
      .lte('attendance_date', toDate);

    if (error) {
      console.error('attendanceSummary: lookup failed:', error);
      res.status(500).json({ msg: 'Server error' });
      return;
    }

    // Seed totals per student from current enrollment so students with zero
    // attendance still appear in the summary.
    const { data: enrollments, error: enrollmentsErr } = await supabase
      .from('batch_students')
      .select('student_id')
      .eq('batch_id', batch_id);

    if (enrollmentsErr) {
      console.error('attendanceSummary: enrollment lookup failed:', enrollmentsErr);
      res.status(500).json({ msg: 'Server error' });
      return;
    }

    type Counts = { present: number; absent: number; late: number; excused: number };
    const blank = (): Counts => ({ present: 0, absent: 0, late: 0, excused: 0 });
    const totals = new Map<string, Counts>();

    for (const e of (enrollments ?? []) as Array<{ student_id: string }>) {
      totals.set(e.student_id, blank());
    }
    for (const r of (rows ?? []) as AttendanceRow[]) {
      const c = totals.get(r.student_id) ?? blank();
      c[r.status] += 1;
      totals.set(r.student_id, c);
    }

    const studentIds = Array.from(totals.keys());
    const userMap = new Map<string, StudentUserRow>();
    const enrollmentMap = new Map<string, string>();

    if (studentIds.length > 0) {
      const [{ data: users, error: usersErr }, { data: profiles, error: profilesErr }] = await Promise.all([
        supabase
          .from('users')
          .select('id, name, username')
          .eq('tution_id', tution_id)
          .in('id', studentIds),
        supabase
          .from('students')
          .select('user_id, enrollment_number')
          .eq('tution_id', tution_id)
          .in('user_id', studentIds)
      ]);

      if (usersErr) {
        console.error('attendanceSummary: users lookup failed:', usersErr);
        res.status(500).json({ msg: 'Server error' });
        return;
      }
      if (profilesErr) {
        console.error('attendanceSummary: students lookup failed:', profilesErr);
        res.status(500).json({ msg: 'Server error' });
        return;
      }

      for (const u of (users ?? []) as StudentUserRow[]) userMap.set(u.id, u);
      for (const p of (profiles ?? []) as StudentProfileRow[]) enrollmentMap.set(p.user_id, p.enrollment_number);
    }

    const summary = studentIds.map((id) => {
      const c = totals.get(id) ?? blank();
      const denom = c.present + c.absent + c.late;
      const percentage = denom === 0 ? null : Math.round((c.present / denom) * 1000) / 10;
      const u = userMap.get(id);
      return {
        student_id: id,
        name: u?.name ?? null,
        username: u?.username ?? null,
        enrollment_number: enrollmentMap.get(id) ?? null,
        present: c.present,
        absent: c.absent,
        late: c.late,
        excused: c.excused,
        attendance_percentage: percentage
      };
    });

    summary.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));

    res.status(200).json({
      from: fromDate,
      to: toDate,
      students: summary
    });
  } catch (err) {
    console.error('attendanceSummary error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};
