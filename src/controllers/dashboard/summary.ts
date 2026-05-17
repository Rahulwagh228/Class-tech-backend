import type { Request, Response } from 'express';
import pool from '../../config/connectpsql.js';

// =============================================================================
// GET /api/v1/dashboard/summary    (auth required, admin)
//
// Headline numbers for the tution's admin dashboard. All counts scoped to
// the caller's tution_id from the JWT.
//
// Active definitions:
//   - active_teachers    : users with role='teacher' in this tution
//   - active_batches     : batches in this tution where end_date IS NULL
//                          OR end_date >= today
//   - total_students     : users with role='student' in this tution
//   - students_this_week : students whose row was created since the start
//                          (Monday 00:00) of the ISO week
//   - teachers_this_week : same but for teachers
//
// Implementation:
//   Two raw `pg` queries run in parallel. The user-counts query uses FILTER
//   so all four metrics come back in a single round-trip.
//   "This week" = since `date_trunc('week', NOW())`, which is Monday 00:00
//   in the database's timezone.
// =============================================================================

interface UserCountsRow {
  total_students: string;       // pg returns COUNT as bigint -> string in JS
  active_teachers: string;
  students_this_week: string;
  teachers_this_week: string;
}

interface BatchCountRow {
  active_batches: string;
}

export const dashboardSummary = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ msg: 'Authentication required' });
      return;
    }
    const tution_id = req.user.tution_id;

    const [userCountsRes, batchCountRes] = await Promise.all([
      pool.query<UserCountsRow>(
        `SELECT
           COUNT(*) FILTER (WHERE role = 'student')                                    AS total_students,
           COUNT(*) FILTER (WHERE role = 'teacher')                                    AS active_teachers,
           COUNT(*) FILTER (WHERE role = 'student'
                              AND created_at >= date_trunc('week', NOW()))            AS students_this_week,
           COUNT(*) FILTER (WHERE role = 'teacher'
                              AND created_at >= date_trunc('week', NOW()))            AS teachers_this_week
           FROM users
          WHERE tution_id = $1`,
        [tution_id]
      ),
      pool.query<BatchCountRow>(
        `SELECT COUNT(*) AS active_batches
           FROM batches
          WHERE tution_id = $1
            AND (end_date IS NULL OR end_date >= CURRENT_DATE)`,
        [tution_id]
      )
    ]);

    const u = userCountsRes.rows[0];
    const b = batchCountRes.rows[0];

    res.json({
      tution_id,
      stats: {
        total_students:    Number(u?.total_students    ?? 0),
        active_teachers:   Number(u?.active_teachers   ?? 0),
        active_batches:    Number(b?.active_batches    ?? 0),
        students_this_week: Number(u?.students_this_week ?? 0),
        teachers_this_week: Number(u?.teachers_this_week ?? 0),
        revenue: {
          available: false,
          total: 0,
          currency: 'INR',
          note: 'Revenue tracking not implemented yet'
        },
        upcoming_events: {
          available: false,
          items: [],
          note: 'Events module not implemented yet'
        }
      },
      week_starts_at: 'Monday 00:00 (server timezone)',
      generated_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('dashboardSummary error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};
