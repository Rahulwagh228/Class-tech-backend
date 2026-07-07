import type { Request, Response } from 'express';
import pool from '../../config/connectpsql.js';

interface PendingFeeRow {
  id: string;
  student_id: string;
  student_name: string;
  title: string;
  description: string | null;
  amount_cents: string;
  paid_cents: string;
  currency: string;
  due_date: string | null;
  status: string;
  created_at: string;
}

// =============================================================================
// GET /api/v1/parent/fees/pending
//   role='parent' only. Returns pending / partial fees for every student
//   linked to the caller via parent_students. No paid fees, no cancelled
//   fees, no payment history — mirrors the student view.
//
// Optional query:
//   student_id = filter to a single child (must still be linked to this parent)
// =============================================================================
export const parentPendingFees = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ msg: 'Authentication required' });
    return;
  }
  const tution_id = req.user.tution_id;
  if (!tution_id) {
    res.status(400).json({ msg: 'Token has no tution_id' });
    return;
  }

  const studentIdFilter =
    typeof req.query.student_id === 'string' && req.query.student_id.trim().length > 0
      ? req.query.student_id.trim()
      : null;

  try {
    const params: (string | null)[] = [tution_id, req.user.id];
    let studentFilterSql = '';
    if (studentIdFilter) {
      studentFilterSql = ` AND f.student_id = $3`;
      params.push(studentIdFilter);
    }

    const result = await pool.query<PendingFeeRow>(
      `SELECT f.id, f.student_id, u.name AS student_name,
              f.title, f.description,
              f.amount_cents, f.paid_cents, f.currency,
              f.due_date, f.status, f.created_at
         FROM fees f
         JOIN parent_students ps
           ON ps.student_user_id = f.student_id
          AND ps.parent_user_id  = $2
          AND ps.tution_id       = $1
         JOIN users u ON u.id = f.student_id
        WHERE f.tution_id = $1
          AND f.status IN ('pending', 'partial')
          ${studentFilterSql}
        ORDER BY u.name ASC, f.due_date ASC NULLS LAST, f.created_at DESC`,
      params
    );

    const fees = result.rows.map((r) => ({
      id: r.id,
      student: { id: r.student_id, name: r.student_name },
      title: r.title,
      description: r.description,
      amount_cents: Number(r.amount_cents),
      paid_cents: Number(r.paid_cents),
      pending_cents: Number(r.amount_cents) - Number(r.paid_cents),
      currency: r.currency,
      due_date: r.due_date,
      status: r.status,
      created_at: r.created_at
    }));

    const total_pending_cents = fees.reduce((sum, f) => sum + f.pending_cents, 0);

    res.status(200).json({ fees, total_pending_cents });
  } catch (err) {
    console.error('parentPendingFees error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};
