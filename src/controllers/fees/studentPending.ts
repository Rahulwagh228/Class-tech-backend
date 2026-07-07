import type { Request, Response } from 'express';
import pool from '../../config/connectpsql.js';

interface PendingFeeRow {
  id: string;
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
// GET /api/v1/student/fees/me/pending
//   role='student' only. Returns only the caller's own pending / partial
//   fees. Does not expose paid fees, cancelled fees, or any other student's
//   data. Payment history is intentionally omitted.
// =============================================================================
export const studentPendingFees = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ msg: 'Authentication required' });
    return;
  }
  const tution_id = req.user.tution_id;
  if (!tution_id) {
    res.status(400).json({ msg: 'Token has no tution_id' });
    return;
  }

  try {
    const result = await pool.query<PendingFeeRow>(
      `SELECT id, title, description, amount_cents, paid_cents,
              currency, due_date, status, created_at
         FROM fees
        WHERE tution_id = $1
          AND student_id = $2
          AND status IN ('pending', 'partial')
        ORDER BY due_date ASC NULLS LAST, created_at DESC`,
      [tution_id, req.user.id]
    );

    const fees = result.rows.map((r) => ({
      id: r.id,
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
    console.error('studentPendingFees error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};
