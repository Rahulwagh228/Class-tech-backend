import type { Request, Response } from 'express';
import pool from '../../config/connectpsql.js';

const ALLOWED_STATUS = new Set(['pending', 'partial', 'paid', 'none']);
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;

interface StudentFeeRow {
  student_id: string;
  name: string;
  username: string;
  profile_photo: string | null;
  enrollment_number: string | null;
  grade_level: string | null;
  section: string | null;
  total_amount_cents: string;
  paid_cents: string;
  fees_count: string;
  currency: string | null;
  last_paid_at: string | null;
  next_due_date: string | null;
}

// =============================================================================
// GET /api/v1/admin/fees/students
//   admin only. Student-centric fees table for the admin dashboard.
//   One row per student in the tution, with fee aggregates rolled up.
//   Paginated.
//
// Query params:
//   status  = 'pending' | 'partial' | 'paid' | 'none'  (optional filter)
//     - 'none'    : students with no non-cancelled fees at all
//     - 'paid'    : students whose non-cancelled fees are fully paid
//     - 'partial' : some money paid, some still owed
//     - 'pending' : nothing paid yet, money owed
//   search  = free-text over student name / username / enrollment (optional)
//   page    = 1-based page number (default 1)
//   limit   = page size (default 20, max 100)
//
// Response:
// {
//   students: [
//     {
//       student: { id, name, username, profile_photo, enrollment_number, grade_level, section },
//       total_amount_cents, paid_cents, pending_cents, fees_count,
//       currency, status, last_paid_at, next_due_date
//     }, ...
//   ],
//   pagination: { page, limit, total, total_pages }
// }
// =============================================================================
export const listStudentsWithFees = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ msg: 'Authentication required' });
    return;
  }
  const tution_id = req.user.tution_id;
  if (!tution_id) {
    res.status(400).json({ msg: 'Token has no tution_id' });
    return;
  }

  const statusParam =
    typeof req.query.status === 'string' ? req.query.status.trim().toLowerCase() : '';
  const searchParam =
    typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const pageRaw = Number(req.query.page);
  const limitRaw = Number(req.query.limit);
  const page = Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const limit = Number.isInteger(limitRaw) && limitRaw > 0
    ? Math.min(limitRaw, MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;
  const offset = (page - 1) * limit;

  if (statusParam && !ALLOWED_STATUS.has(statusParam)) {
    res.status(400).json({ msg: 'status must be one of: pending, partial, paid, none' });
    return;
  }

  // Build filter for the outer query. We aggregate first, then filter by
  // computed status. Search filters by user columns and is safe to apply
  // in the base WHERE.
  const params: (string | number)[] = [tution_id];
  const whereParts: string[] = [`u.tution_id = $1`, `u.role = 'student'`];
  let idx = 2;

  if (searchParam) {
    whereParts.push(
      `(u.name ILIKE $${idx} OR u.username ILIKE $${idx} OR COALESCE(s.enrollment_number, '') ILIKE $${idx})`
    );
    params.push(`%${searchParam}%`);
    idx++;
  }
  const whereSql = whereParts.join(' AND ');

  // status filter is applied on the aggregated columns, so we need a HAVING-
  // like condition. Do it as an outer WHERE on the CTE.
  let statusSql = '';
  if (statusParam === 'none') {
    statusSql = ` AND fees_count = 0`;
  } else if (statusParam === 'paid') {
    statusSql = ` AND fees_count > 0 AND paid_cents >= total_amount_cents`;
  } else if (statusParam === 'partial') {
    statusSql = ` AND fees_count > 0 AND paid_cents > 0 AND paid_cents < total_amount_cents`;
  } else if (statusParam === 'pending') {
    statusSql = ` AND fees_count > 0 AND paid_cents = 0`;
  }

  try {
    const baseCte = `
      WITH student_fee_agg AS (
        SELECT
          u.id                                                        AS student_id,
          u.name,
          u.username,
          u.profile_photo,
          s.enrollment_number,
          s.grade_level,
          s.section,
          COALESCE(SUM(f.amount_cents) FILTER (WHERE f.status <> 'cancelled'), 0)::text AS total_amount_cents,
          COALESCE(SUM(f.paid_cents)   FILTER (WHERE f.status <> 'cancelled'), 0)::text AS paid_cents,
          COUNT(f.id) FILTER (WHERE f.status <> 'cancelled')::text                       AS fees_count,
          MAX(f.currency)                                                                AS currency,
          MAX(p.paid_at)                                                                 AS last_paid_at,
          MIN(f.due_date) FILTER (WHERE f.status IN ('pending', 'partial'))              AS next_due_date
        FROM users u
        LEFT JOIN students s ON s.user_id = u.id
        LEFT JOIN fees f     ON f.student_id = u.id AND f.tution_id = u.tution_id
        LEFT JOIN fee_payments p ON p.fee_id = f.id
        WHERE ${whereSql}
        GROUP BY u.id, u.name, u.username, u.profile_photo,
                 s.enrollment_number, s.grade_level, s.section
      )
    `;

    // Total count (applies same status filter)
    const countResult = await pool.query<{ count: string }>(
      `${baseCte}
       SELECT COUNT(*)::text AS count
         FROM student_fee_agg
        WHERE 1=1${statusSql}`,
      params
    );
    const total = Number(countResult.rows[0]?.count ?? '0');

    // Rows
    const listParams = [...params, limit, offset];
    const listResult = await pool.query<StudentFeeRow>(
      `${baseCte}
       SELECT *
         FROM student_fee_agg
        WHERE 1=1${statusSql}
        ORDER BY (paid_cents::bigint < total_amount_cents::bigint) DESC,
                 next_due_date ASC NULLS LAST,
                 name ASC
        LIMIT $${idx++} OFFSET $${idx++}`,
      listParams
    );

    const students = listResult.rows.map((r) => {
      const total_amount_cents = Number(r.total_amount_cents);
      const paid_cents = Number(r.paid_cents);
      const pending_cents = total_amount_cents - paid_cents;
      const fees_count = Number(r.fees_count);

      let rowStatus: 'none' | 'paid' | 'partial' | 'pending';
      if (fees_count === 0) rowStatus = 'none';
      else if (paid_cents >= total_amount_cents) rowStatus = 'paid';
      else if (paid_cents > 0) rowStatus = 'partial';
      else rowStatus = 'pending';

      return {
        student: {
          id: r.student_id,
          name: r.name,
          username: r.username,
          profile_photo: r.profile_photo,
          enrollment_number: r.enrollment_number,
          grade_level: r.grade_level,
          section: r.section
        },
        total_amount_cents,
        paid_cents,
        pending_cents,
        fees_count,
        currency: r.currency ?? 'INR',
        status: rowStatus,
        last_paid_at: r.last_paid_at,
        next_due_date: r.next_due_date
      };
    });

    res.status(200).json({
      students,
      pagination: {
        page,
        limit,
        total,
        total_pages: total === 0 ? 0 : Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error('listStudentsWithFees error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};
