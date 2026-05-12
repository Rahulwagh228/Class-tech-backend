import type { Request, Response } from 'express';
import supabase from '../../config/connectSupabase.js';
import { daysBetween, isIsoDate, isoDateNDaysAgo, todayIsoDate } from '../../lib/dates.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_LOOKBACK_DAYS = 90;
const MAX_RANGE_DAYS = 365;

type Status = 'present' | 'absent' | 'late' | 'excused';

interface BatchRow {
  id: string;
  tution_id: string;
  name: string;
  code: string;
  subject: string | null;
  schedule: string | null;
  start_date: string;
  end_date: string | null;
}

interface BatchTeacherLink {
  teacher_user_id: string;
  is_lead: boolean;
}

interface AttendanceRow {
  id: string;
  attendance_date: string;
  status: Status;
  notes: string | null;
  marked_by: string;
  last_edited_by: string | null;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// GET /api/v1/attendance/students/:studentId/batches/:batchId
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD  - defaults to last 90 days
//
// Records + summary for a single (student, batch) pair. Verifies the student
// is actually enrolled in the batch and the batch belongs to the caller's
// tution.
// =============================================================================
export const studentBatchDetail = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ msg: 'Authentication required' });
      return;
    }
    const tution_id = req.user.tution_id;
    const studentId = req.params.studentId as string;
    const batchId = req.params.batchId as string | undefined;

    if (!batchId || !UUID_RE.test(batchId)) {
      res.status(400).json({ msg: 'batchId must be a valid UUID' });
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

    const [{ data: batch, error: batchErr }, { data: enrollment, error: enrollErr }] = await Promise.all([
      supabase
        .from('batches')
        .select('id, tution_id, name, code, subject, schedule, start_date, end_date')
        .eq('id', batchId)
        .eq('tution_id', tution_id)
        .maybeSingle<BatchRow>(),
      supabase
        .from('batch_students')
        .select('joined_at')
        .eq('batch_id', batchId)
        .eq('student_id', studentId)
        .maybeSingle<{ joined_at: string }>()
    ]);

    if (batchErr) {
      console.error('studentBatchDetail: batch lookup failed:', batchErr);
      res.status(500).json({ msg: 'Server error' });
      return;
    }
    if (enrollErr) {
      console.error('studentBatchDetail: enrollment lookup failed:', enrollErr);
      res.status(500).json({ msg: 'Server error' });
      return;
    }
    if (!batch || !enrollment) {
      res.status(404).json({ msg: 'Batch not found or student not enrolled' });
      return;
    }

    const { data: teacherLinks, error: teacherLinksErr } = await supabase
      .from('batch_teachers')
      .select('teacher_user_id, is_lead')
      .eq('batch_id', batchId);
    if (teacherLinksErr) {
      console.error('studentBatchDetail: batch_teachers lookup failed:', teacherLinksErr);
      res.status(500).json({ msg: 'Server error' });
      return;
    }
    const teacherLinkRows = (teacherLinks ?? []) as BatchTeacherLink[];
    const isLeadMap = new Map<string, boolean>(
      teacherLinkRows.map((t) => [t.teacher_user_id, t.is_lead])
    );

    let teachers: Array<{ id: string; name: string; profile_photo: string | null; is_lead: boolean }> = [];
    if (teacherLinkRows.length > 0) {
      const { data: teacherRows, error: teacherErr } = await supabase
        .from('users')
        .select('id, name, profile_photo')
        .eq('tution_id', tution_id)
        .in('id', teacherLinkRows.map((t) => t.teacher_user_id));
      if (teacherErr) {
        console.error('studentBatchDetail: teacher lookup failed:', teacherErr);
        res.status(500).json({ msg: 'Server error' });
        return;
      }
      teachers = ((teacherRows ?? []) as Array<{ id: string; name: string; profile_photo: string | null }>)
        .map((u) => ({ ...u, is_lead: isLeadMap.get(u.id) ?? false }))
        .sort((a, b) => (b.is_lead ? 1 : 0) - (a.is_lead ? 1 : 0) || a.name.localeCompare(b.name));
    }

    const { data: rows, error: rowsErr } = await supabase
      .from('attendance_records')
      .select('id, attendance_date, status, notes, marked_by, last_edited_by, created_at, updated_at')
      .eq('tution_id', tution_id)
      .eq('batch_id', batchId)
      .eq('student_id', studentId)
      .gte('attendance_date', fromDate)
      .lte('attendance_date', toDate)
      .order('attendance_date', { ascending: false });

    if (rowsErr) {
      console.error('studentBatchDetail: attendance lookup failed:', rowsErr);
      res.status(500).json({ msg: 'Server error' });
      return;
    }

    const records = (rows ?? []) as AttendanceRow[];
    const counts = { present: 0, absent: 0, late: 0, excused: 0 };
    for (const r of records) counts[r.status] += 1;
    const denom = counts.present + counts.absent + counts.late;
    const percentage = denom === 0 ? null : Math.round((counts.present / denom) * 1000) / 10;

    res.status(200).json({
      student_id: studentId,
      batch: {
        id: batch.id,
        name: batch.name,
        code: batch.code,
        subject: batch.subject,
        schedule: batch.schedule,
        start_date: batch.start_date,
        end_date: batch.end_date,
        teachers,
        joined_at: enrollment.joined_at
      },
      from: fromDate,
      to: toDate,
      summary: {
        ...counts,
        attendance_percentage: percentage
      },
      records
    });
  } catch (err) {
    console.error('studentBatchDetail error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};
