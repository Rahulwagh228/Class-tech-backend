import type { Request, Response } from 'express';
import pool from '../../config/connectpsql.js';
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

interface AttendanceResultRow extends AttendanceRow {
  student_user_id: string | null;
  student_name: string | null;
  student_username: string | null;
  student_profile_photo: string | null;
  student_enrollment_number: string | null;
}

// =============================================================================
// GET /api/v1/attendance/batches/:batchId
//   ?date=YYYY-MM-DD  - single day
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD  - inclusive range, max 90 days
//
// requireBatchAccess has already validated tenant + ownership.
// =============================================================================
export const listAttendance = async (req: Request, res: Response): Promise<void> => {
  console.log("api hittttttttttttttttttttttttttttttttttttttttttttttttttttttttttt")
  try {
    if (!req.user || !req.batch) {
      res.status(401).json({ msg: 'Authentication required' });
      return;
    }

    const tution_id = req.user.tution_id;
    const batch_id = req.batch.id;
    const { date, from, to } = req.query as Record<string, string | undefined>;

    const values: string[] = [tution_id, batch_id];
    const whereClauses = ['ar.tution_id = $1', 'ar.batch_id = $2'];

    if (date) {
      if (!isIsoDate(date)) {
        res.status(400).json({ msg: 'date must be YYYY-MM-DD' });
        return;
      }
      values.push(date);
      whereClauses.push(`ar.attendance_date = $${values.length}`);
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
      values.push(from);
      whereClauses.push(`ar.attendance_date >= $${values.length}`);
      values.push(to);
      whereClauses.push(`ar.attendance_date <= $${values.length}`);
    }

    const result = await pool.query<AttendanceResultRow>(
      `SELECT
          ar.id,
          ar.batch_id,
          ar.student_id,
          ar.attendance_date,
          ar.status,
          ar.notes,
          ar.marked_by,
          ar.last_edited_by,
          ar.created_at,
          ar.updated_at,
          u.id            AS student_user_id,
          u.name          AS student_name,
          u.username      AS student_username,
          u.profile_photo AS student_profile_photo,
          s.enrollment_number AS student_enrollment_number
         FROM attendance_records ar
         LEFT JOIN users u
           ON u.id = ar.student_id
          AND u.tution_id = ar.tution_id
         LEFT JOIN students s
           ON s.user_id = ar.student_id
          AND s.tution_id = ar.tution_id
        WHERE ${whereClauses.join(' AND ')}
        ORDER BY ar.attendance_date DESC, ar.student_id ASC`,
      values
    );

    const out = result.rows.map((r) => ({
      id: r.id,
      batch_id: r.batch_id,
      student_id: r.student_id,
      attendance_date: r.attendance_date,
      status: r.status,
      notes: r.notes,
      marked_by: r.marked_by,
      last_edited_by: r.last_edited_by,
      created_at: r.created_at,
      updated_at: r.updated_at,
      student: r.student_user_id
        ? {
            id: r.student_id,
            name: r.student_name,
            username: r.student_username,
            profile_photo: r.student_profile_photo,
            enrollment_number: r.student_enrollment_number
          }
        : null
    }));

    res.status(200).json({ count: out.length, records: out });
  } catch (err) {
    console.error('listAttendance error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};
