import type { Request, Response } from 'express';
import pool from '../../config/connectpsql.js';

interface SummaryRow {
  total_fees: string;
  paid_fees: string;
  pending_fees: string;
  partial_fees: string;
  cancelled_fees: string;
  total_amount_cents: string;
  total_paid_cents: string;
  total_pending_cents: string;
}

// =============================================================================
// GET /api/v1/admin/fees/summary
//   admin only. Aggregate counters for the fees dashboard header.
// =============================================================================
export const feesSummary = async (req: Request, res: Response): Promise<void> => {
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
    const result = await pool.query<SummaryRow>(
      `SELECT
         COUNT(*)::text                                                              AS total_fees,
         COUNT(*) FILTER (WHERE status = 'paid')::text                               AS paid_fees,
         COUNT(*) FILTER (WHERE status = 'pending')::text                            AS pending_fees,
         COUNT(*) FILTER (WHERE status = 'partial')::text                            AS partial_fees,
         COUNT(*) FILTER (WHERE status = 'cancelled')::text                          AS cancelled_fees,
         COALESCE(SUM(amount_cents) FILTER (WHERE status <> 'cancelled'), 0)::text   AS total_amount_cents,
         COALESCE(SUM(paid_cents)   FILTER (WHERE status <> 'cancelled'), 0)::text   AS total_paid_cents,
         COALESCE(SUM(amount_cents - paid_cents) FILTER (WHERE status <> 'cancelled'), 0)::text
                                                                                    AS total_pending_cents
       FROM fees
       WHERE tution_id = $1`,
      [tution_id]
    );

    const r = result.rows[0]!;
    res.status(200).json({
      summary: {
        total_fees: Number(r.total_fees),
        paid_fees: Number(r.paid_fees),
        pending_fees: Number(r.pending_fees),
        partial_fees: Number(r.partial_fees),
        cancelled_fees: Number(r.cancelled_fees),
        total_amount_cents: Number(r.total_amount_cents),
        total_paid_cents: Number(r.total_paid_cents),
        total_pending_cents: Number(r.total_pending_cents)
      }
    });
  } catch (err) {
    console.error('feesSummary error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};
