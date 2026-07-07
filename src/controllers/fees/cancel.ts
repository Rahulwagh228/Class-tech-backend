import type { Request, Response } from 'express';
import pool from '../../config/connectpsql.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// =============================================================================
// DELETE /api/v1/admin/fees/:feeId
//   admin only. Soft-cancels a fee (sets status='cancelled'). Payment history
//   is preserved. Refuses to cancel fully-paid fees.
// =============================================================================
export const cancelFee = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ msg: 'Authentication required' });
    return;
  }
  const tution_id = req.user.tution_id;
  if (!tution_id) {
    res.status(400).json({ msg: 'Token has no tution_id' });
    return;
  }

  const feeId = (req.params.feeId as string | undefined) ?? '';
  if (!UUID_RE.test(feeId)) {
    res.status(400).json({ msg: 'feeId must be a valid UUID' });
    return;
  }

  try {
    const result = await pool.query<{ id: string; status: string }>(
      `UPDATE fees
          SET status = 'cancelled'
        WHERE id = $1
          AND tution_id = $2
          AND status <> 'paid'
        RETURNING id, status`,
      [feeId, tution_id]
    );

    if (result.rowCount === 0) {
      const exists = await pool.query<{ status: string }>(
        `SELECT status FROM fees WHERE id = $1 AND tution_id = $2`,
        [feeId, tution_id]
      );
      if (exists.rowCount === 0) {
        res.status(404).json({ msg: 'Fee not found' });
      } else {
        res.status(409).json({ msg: 'Cannot cancel a fully paid fee' });
      }
      return;
    }

    res.status(200).json({ msg: 'Fee cancelled', fee: result.rows[0] });
  } catch (err) {
    console.error('cancelFee error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};
