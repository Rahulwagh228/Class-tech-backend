import type { Request, Response } from 'express';
import supabase from '../../config/connectSupabase.js';
import { daysBetween, isIsoDate, isoDateNDaysAgo, todayIsoDate } from '../../lib/dates.js';

const DEFAULT_LOOKBACK_DAYS = 30;
const MAX_RANGE_DAYS = 365;

type Status = 'present' | 'absent' | 'late' | 'excused';

interface BatchStudentRow {
  batch_id: string;
  joined_at: string;
}

interface BatchRow {
  id: string;
  name: string;
  code: string;
  subject: string | null;
  schedule: string | null;
  teacher_id: string | null;
  start_date: string;
  end_date: string | null;
}

interface AttendanceCountRow {
  batch_id: string;
  status: Status;
}

interface TeacherRow {
  id: string;
  name: string;
  profile_photo: string | null;
}

// =============================================================================
// GET /api/v1/attendance/students/:studentId/batches
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD  - defaults to last 30 days
//
// Lists every batch the student is currently enrolled in, with per-batch
// attendance stats over the requested window.
// =============================================================================
export const studentBatches = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ msg: 'Authentication required' });
      return;
    }
    const tution_id = req.user.tution_id;
    const studentId = req.params.studentId as string;

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

    const { data: enrollments, error: enrollmentsErr } = await supabase
      .from('batch_students')
      .select('batch_id, joined_at')
      .eq('student_id', studentId);

    if (enrollmentsErr) {
      console.error('studentBatches: enrollment lookup failed:', enrollmentsErr);
      res.status(500).json({ msg: 'Server error' });
      return;
    }

    const enrollmentRows = (enrollments ?? []) as BatchStudentRow[];
    const batchIds = enrollmentRows.map((e) => e.batch_id);
    if (batchIds.length === 0) {
      res.status(200).json({ student_id: studentId, from: fromDate, to: toDate, batches: [] });
      return;
    }
    const joinedAt = new Map(enrollmentRows.map((e) => [e.batch_id, e.joined_at]));

    const [{ data: batches, error: batchesErr }, { data: counts, error: countsErr }] = await Promise.all([
      supabase
        .from('batches')
        .select('id, name, code, subject, schedule, teacher_id, start_date, end_date')
        .eq('tution_id', tution_id)
        .in('id', batchIds),
      supabase
        .from('attendance_records')
        .select('batch_id, status')
        .eq('tution_id', tution_id)
        .eq('student_id', studentId)
        .in('batch_id', batchIds)
        .gte('attendance_date', fromDate)
        .lte('attendance_date', toDate)
    ]);

    if (batchesErr) {
      console.error('studentBatches: batch lookup failed:', batchesErr);
      res.status(500).json({ msg: 'Server error' });
      return;
    }
    if (countsErr) {
      console.error('studentBatches: attendance lookup failed:', countsErr);
      res.status(500).json({ msg: 'Server error' });
      return;
    }

    const batchRows = (batches ?? []) as BatchRow[];
    const teacherIds = Array.from(new Set(batchRows.map((b) => b.teacher_id).filter(Boolean) as string[]));
    const teacherMap = new Map<string, TeacherRow>();
    if (teacherIds.length > 0) {
      const { data: teachers, error: teachersErr } = await supabase
        .from('users')
        .select('id, name, profile_photo')
        .eq('tution_id', tution_id)
        .in('id', teacherIds);
      if (teachersErr) {
        console.error('studentBatches: teacher lookup failed:', teachersErr);
        res.status(500).json({ msg: 'Server error' });
        return;
      }
      for (const t of (teachers ?? []) as TeacherRow[]) teacherMap.set(t.id, t);
    }

    type Counts = { present: number; absent: number; late: number; excused: number };
    const blank = (): Counts => ({ present: 0, absent: 0, late: 0, excused: 0 });
    const countMap = new Map<string, Counts>();
    for (const r of (counts ?? []) as AttendanceCountRow[]) {
      const c = countMap.get(r.batch_id) ?? blank();
      c[r.status] += 1;
      countMap.set(r.batch_id, c);
    }

    const out = batchRows.map((b) => {
      const c = countMap.get(b.id) ?? blank();
      const denom = c.present + c.absent + c.late;
      const percentage = denom === 0 ? null : Math.round((c.present / denom) * 1000) / 10;
      return {
        id: b.id,
        name: b.name,
        code: b.code,
        subject: b.subject,
        schedule: b.schedule,
        start_date: b.start_date,
        end_date: b.end_date,
        joined_at: joinedAt.get(b.id) ?? null,
        teacher: b.teacher_id ? teacherMap.get(b.teacher_id) ?? null : null,
        summary: {
          from: fromDate,
          to: toDate,
          present: c.present,
          absent: c.absent,
          late: c.late,
          excused: c.excused,
          attendance_percentage: percentage
        }
      };
    });

    out.sort((a, b) => a.name.localeCompare(b.name));

    res.status(200).json({
      student_id: studentId,
      from: fromDate,
      to: toDate,
      batches: out
    });
  } catch (err) {
    console.error('studentBatches error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};
