import type { Request, Response } from 'express';
import pool from '../../config/connectpsql.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_METHODS = new Set(['cash', 'upi', 'card', 'bank_transfer', 'cheque', 'other']);

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function nullIfEmpty(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// =============================================================================
// POST /api/v1/admin/fees/:feeId/payments
//   admin only. Records a payment against a fee. Updates fee.paid_cents
//   and fee.status atomically. Rejects overpayment.
//
// Body:
// {
//   amount_cents: number,
//   method?: 'cash' | 'upi' | 'card' | 'bank_transfer' | 'cheque' | 'other',
//   reference?: string,
//   notes?: string,
//   paid_at?: ISO timestamp (defaults to NOW())
// }
// =============================================================================
export const recordFeePayment = async (req: Request, res: Response): Promise<void> => {
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

  const body = (req.body ?? {}) as Record<string, unknown>;
  const amount_cents = Number(body.amount_cents);
  const methodRaw = trimString(body.method).toLowerCase();
  const method = methodRaw.length > 0 ? methodRaw : 'cash';
  const reference = nullIfEmpty(body.reference);
  const notes = nullIfEmpty(body.notes);
  const paidAtRaw = trimString(body.paid_at);

  if (!Number.isFinite(amount_cents) || !Number.isInteger(amount_cents) || amount_cents <= 0) {
    res.status(400).json({ msg: 'amount_cents must be a positive integer' });
    return;
  }
  if (!ALLOWED_METHODS.has(method)) {
    res.status(400).json({
      msg: 'method must be one of: cash, upi, card, bank_transfer, cheque, other'
    });
    return;
  }
  let paidAt: Date | null = null;
  if (paidAtRaw) {
    const d = new Date(paidAtRaw);
    if (Number.isNaN(d.getTime())) {
      res.status(400).json({ msg: 'paid_at must be a valid ISO timestamp' });
      return;
    }
    paidAt = d;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the fee row so concurrent payments can't overpay.
    const feeResult = await client.query<{
      id: string;
      amount_cents: string;
      paid_cents: string;
      status: string;
    }>(
      `SELECT id, amount_cents, paid_cents, status
         FROM fees
        WHERE id = $1 AND tution_id = $2
        FOR UPDATE`,
      [feeId, tution_id]
    );

    if (feeResult.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ msg: 'Fee not found' });
      return;
    }
    const fee = feeResult.rows[0]!;
    if (fee.status === 'cancelled') {
      await client.query('ROLLBACK');
      res.status(409).json({ msg: 'Cannot record payment on a cancelled fee' });
      return;
    }

    const amount = BigInt(fee.amount_cents);
    const alreadyPaid = BigInt(fee.paid_cents);
    const newPaid = alreadyPaid + BigInt(amount_cents);
    if (newPaid > amount) {
      await client.query('ROLLBACK');
      res.status(400).json({
        msg: 'Payment exceeds fee amount',
        amount_cents: Number(amount),
        already_paid_cents: Number(alreadyPaid),
        attempted_cents: amount_cents
      });
      return;
    }

    const newStatus = newPaid === amount ? 'paid' : 'partial';

    const payInsert = await client.query(
      `INSERT INTO fee_payments
         (tution_id, fee_id, amount_cents, method, reference, notes, paid_at, recorded_by)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, NOW()), $8)
       RETURNING id, fee_id, amount_cents, method, reference, notes, paid_at, recorded_by, created_at`,
      [tution_id, feeId, amount_cents, method, reference, notes, paidAt, req.user.id]
    );

    const feeUpdate = await client.query(
      `UPDATE fees
          SET paid_cents = $1, status = $2
        WHERE id = $3
        RETURNING id, tution_id, student_id, title, amount_cents, paid_cents,
                  currency, due_date, status, updated_at`,
      [newPaid.toString(), newStatus, feeId]
    );

    await client.query('COMMIT');

    res.status(201).json({
      msg: 'Payment recorded',
      payment: payInsert.rows[0],
      fee: feeUpdate.rows[0]
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('recordFeePayment error:', err);
    res.status(500).json({ msg: 'Server error' });
  } finally {
    client.release();
  }
};
