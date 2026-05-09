import type { Request, Response } from 'express';
import supabase from '../../config/connectSupabase.js';
import { isIsoDate, todayIsoDate } from '../../lib/dates.js';

export const ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'excused'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BULK_RECORDS = 500;

interface MarkRecordInput {
  student_id: string;
  status: AttendanceStatus;
  notes?: string | null;
}

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
// POST /api/v1/attendance/batches/:batchId/mark
//
// Bulk-upsert attendance for a single date. Idempotent: re-posting for the
// same (batch, student, date) updates the existing row and bumps
// last_edited_by + updated_at.
//
// requireBatchAccess has already validated tenant + ownership and attached
// req.batch.
//
// Body:
// {
//   date: "YYYY-MM-DD",      // optional, defaults to today
//   records: [
//     { student_id: "uuid", status: "present", notes?: string }
//   ]
// }
//
// Response: { created: N, updated: M, records: AttendanceRow[] }
// =============================================================================
export const markAttendance = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user || !req.batch) {
      res.status(401).json({ msg: 'Authentication required' });
      return;
    }

    const tution_id = req.user.tution_id;
    const batch_id = req.batch.id;
    const body = (req.body ?? {}) as Record<string, unknown>;

    let attendance_date = todayIsoDate();
    if (body.date !== undefined && body.date !== null && body.date !== '') {
      if (typeof body.date !== 'string' || !isIsoDate(body.date.trim())) {
        res.status(400).json({ msg: 'date must be a valid YYYY-MM-DD string' });
        return;
      }
      attendance_date = body.date.trim();
    }

    // Reject future dates - attendance cannot be marked for classes that
    // haven't happened yet.
    if (attendance_date > todayIsoDate()) {
      res.status(400).json({ msg: 'date cannot be in the future' });
      return;
    }

    if (!Array.isArray(body.records) || body.records.length === 0) {
      res.status(400).json({ msg: 'records must be a non-empty array' });
      return;
    }
    if (body.records.length > MAX_BULK_RECORDS) {
      res.status(400).json({ msg: `records exceeds max of ${MAX_BULK_RECORDS}` });
      return;
    }

    const records: MarkRecordInput[] = [];
    const seenStudentIds = new Set<string>();
    for (const raw of body.records) {
      if (typeof raw !== 'object' || raw === null) {
        res.status(400).json({ msg: 'each record must be an object' });
        return;
      }
      const r = raw as Record<string, unknown>;
      const sid = typeof r.student_id === 'string' ? r.student_id.trim() : '';
      if (!sid || !UUID_RE.test(sid)) {
        res.status(400).json({ msg: 'each record needs a valid student_id (UUID)' });
        return;
      }
      if (seenStudentIds.has(sid)) {
        res.status(400).json({ msg: `duplicate student_id in records: ${sid}` });
        return;
      }
      seenStudentIds.add(sid);

      const status = typeof r.status === 'string' ? r.status.trim() : '';
      if (!ATTENDANCE_STATUSES.includes(status as AttendanceStatus)) {
        res.status(400).json({
          msg: `each record needs a valid status (one of ${ATTENDANCE_STATUSES.join(', ')})`
        });
        return;
      }

      let notes: string | null = null;
      if (r.notes !== undefined && r.notes !== null) {
        if (typeof r.notes !== 'string') {
          res.status(400).json({ msg: 'notes must be a string or null' });
          return;
        }
        const trimmed = r.notes.trim();
        notes = trimmed.length > 0 ? trimmed : null;
      }

      records.push({ student_id: sid, status: status as AttendanceStatus, notes });
    }

    const studentIds = records.map((r) => r.student_id);

    // All-or-nothing: every student in the payload must currently be enrolled
    // in this batch. Mirrors the rollback-on-bad-input pattern in createBatch.
    const { data: enrolled, error: enrolledErr } = await supabase
      .from('batch_students')
      .select('student_id')
      .eq('batch_id', batch_id)
      .in('student_id', studentIds);

    if (enrolledErr) {
      console.error('markAttendance: batch_students lookup failed:', enrolledErr);
      res.status(500).json({ msg: 'Server error' });
      return;
    }

    const enrolledSet = new Set((enrolled ?? []).map((r) => (r as { student_id: string }).student_id));
    const missing = studentIds.filter((id) => !enrolledSet.has(id));
    if (missing.length > 0) {
      res.status(400).json({
        msg: 'One or more students are not enrolled in this batch',
        not_enrolled_student_ids: missing
      });
      return;
    }

    // Pre-query existing rows so we can report created vs updated counts and
    // preserve the original marked_by on updates.
    const { data: existingRows, error: existingErr } = await supabase
      .from('attendance_records')
      .select('id, student_id, marked_by')
      .eq('batch_id', batch_id)
      .eq('attendance_date', attendance_date)
      .in('student_id', studentIds);

    if (existingErr) {
      console.error('markAttendance: existing lookup failed:', existingErr);
      res.status(500).json({ msg: 'Server error' });
      return;
    }

    const existingByStudent = new Map<string, { id: string; marked_by: string }>();
    for (const row of (existingRows ?? []) as Array<{ id: string; student_id: string; marked_by: string }>) {
      existingByStudent.set(row.student_id, { id: row.id, marked_by: row.marked_by });
    }

    const now = new Date().toISOString();
    const upsertRows = records.map((r) => {
      const existing = existingByStudent.get(r.student_id);
      return {
        // include id when updating so onConflict picks the same PK
        ...(existing ? { id: existing.id } : {}),
        tution_id,
        batch_id,
        student_id: r.student_id,
        attendance_date,
        status: r.status,
        notes: r.notes,
        marked_by: existing ? existing.marked_by : req.user!.id,
        last_edited_by: existing ? req.user!.id : null,
        updated_at: now
      };
    });

    const { data: upserted, error: upsertErr } = await supabase
      .from('attendance_records')
      .upsert(upsertRows, { onConflict: 'batch_id,student_id,attendance_date' })
      .select(
        'id, tution_id, batch_id, student_id, attendance_date, status, notes, marked_by, last_edited_by, created_at, updated_at'
      );

    if (upsertErr || !upserted) {
      console.error('markAttendance: upsert failed:', upsertErr);
      res.status(500).json({ msg: upsertErr?.message ?? 'Failed to record attendance' });
      return;
    }

    const created = records.length - existingByStudent.size;
    const updated = existingByStudent.size;

    res.status(200).json({
      msg: 'Attendance recorded',
      date: attendance_date,
      created,
      updated,
      records: upserted as AttendanceRow[]
    });
  } catch (err) {
    console.error('markAttendance error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};
