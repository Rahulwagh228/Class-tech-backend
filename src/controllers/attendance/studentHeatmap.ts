import type { Request, Response } from 'express';
import supabase from '../../config/connectSupabase.js';
import { daysBetween, isIsoDate, todayIsoDate } from '../../lib/dates.js';

const MAX_RANGE_DAYS = 400; // a calendar year + a bit of slack

type Status = 'present' | 'absent' | 'late' | 'excused';

interface AttendanceRow {
  attendance_date: string;
  status: Status;
  batch_id: string;
}

// "best-status-of-the-day" priority. A student showing up to ANY of their
// classes counts as present for that cell - matches the intuitive heatmap
// reading ("did they go to school today?"). Tweak if your design instead
// wants worst-status-wins.
const PRIORITY: Record<Status, number> = { present: 4, late: 3, excused: 2, absent: 1 };

function startOfYear(): string {
  return `${new Date().getUTCFullYear()}-01-01`;
}

// =============================================================================
// GET /api/v1/attendance/students/:studentId/heatmap
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD  - defaults to Jan 1 -> today of the
//                                     current calendar year
//
// Aggregates per-day across every batch the student attends. Days with no
// records are simply omitted - the frontend renders those cells blank.
// =============================================================================
export const studentHeatmap = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ msg: 'Authentication required' });
      return;
    }
    const tution_id = req.user.tution_id;
    const studentId = req.params.studentId as string;

    const { from, to } = req.query as Record<string, string | undefined>;
    const fromDate = from ?? startOfYear();
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
      .select('attendance_date, status, batch_id')
      .eq('tution_id', tution_id)
      .eq('student_id', studentId)
      .gte('attendance_date', fromDate)
      .lte('attendance_date', toDate);

    if (error) {
      console.error('studentHeatmap: lookup failed:', error);
      res.status(500).json({ msg: 'Server error' });
      return;
    }

    const records = (rows ?? []) as AttendanceRow[];
    type DayBucket = { present: number; absent: number; late: number; excused: number; total: number; dominant: Status };
    const days = new Map<string, DayBucket>();

    const totals = { present: 0, absent: 0, late: 0, excused: 0 };

    for (const r of records) {
      totals[r.status] += 1;
      let bucket = days.get(r.attendance_date);
      if (!bucket) {
        bucket = { present: 0, absent: 0, late: 0, excused: 0, total: 0, dominant: r.status };
        days.set(r.attendance_date, bucket);
      }
      bucket[r.status] += 1;
      bucket.total += 1;
      if (PRIORITY[r.status] > PRIORITY[bucket.dominant]) {
        bucket.dominant = r.status;
      }
    }

    const out = Array.from(days.entries())
      .map(([date, b]) => ({
        date,
        present: b.present,
        absent: b.absent,
        late: b.late,
        excused: b.excused,
        total: b.total,
        dominant_status: b.dominant
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    res.status(200).json({
      student_id: studentId,
      from: fromDate,
      to: toDate,
      totals,
      days: out
    });
  } catch (err) {
    console.error('studentHeatmap error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};
