import type { Request, Response } from 'express';
import pool from '../../config/connectpsql.js';
import { isIsoDate } from '../../lib/dates.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function nullIfEmpty(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// =============================================================================
// POST /api/v1/admin/fees
//   admin only. Creates one fee row for one student.
//
// Body:
// {
//   student_id: string (UUID),
//   title: string,
//   description?: string,
//   amount_cents: number,        // amount in the smallest currency unit
//   currency?: string,           // defaults to 'INR', must be 3 letters
//   due_date?: "YYYY-MM-DD"
// }
// =============================================================================
export const createFee = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ msg: 'Authentication required' });
    return;
  }
  const tution_id = req.user.tution_id;
  if (!tution_id) {
    res.status(400).json({ msg: 'Token has no tution_id' });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const student_id = trimString(body.student_id);
  const title = trimString(body.title);
  const description = nullIfEmpty(body.description);
  const amount_cents = Number(body.amount_cents);
  const currencyRaw = trimString(body.currency);
  const currency = currencyRaw.length > 0 ? currencyRaw.toUpperCase() : 'INR';
  const due_date =
    body.due_date === undefined || body.due_date === null || body.due_date === ''
      ? null
      : trimString(body.due_date);

  if (!UUID_RE.test(student_id)) {
    res.status(400).json({ msg: 'student_id must be a valid UUID' });
    return;
  }
  if (!title) {
    res.status(400).json({ msg: 'title is required' });
    return;
  }
  if (!Number.isFinite(amount_cents) || !Number.isInteger(amount_cents) || amount_cents <= 0) {
    res.status(400).json({ msg: 'amount_cents must be a positive integer' });
    return;
  }
  if (currency.length !== 3) {
    res.status(400).json({ msg: 'currency must be a 3-letter ISO code' });
    return;
  }
  if (due_date !== null && !isIsoDate(due_date)) {
    res.status(400).json({ msg: 'due_date must be a valid YYYY-MM-DD date' });
    return;
  }

  try {
    // Verify student belongs to this tution.
    const studentCheck = await pool.query<{ id: string }>(
      `SELECT id FROM users
        WHERE id = $1 AND tution_id = $2 AND role = 'student'`,
      [student_id, tution_id]
    );
    if (studentCheck.rowCount === 0) {
      res.status(404).json({ msg: 'Student not found in this institution' });
      return;
    }

    const insert = await pool.query(
      `INSERT INTO fees
         (tution_id, student_id, title, description, amount_cents, currency, due_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, tution_id, student_id, title, description,
                 amount_cents, paid_cents, currency, due_date, status,
                 created_by, created_at, updated_at`,
      [tution_id, student_id, title, description, amount_cents, currency, due_date, req.user.id]
    );

    res.status(201).json({ msg: 'Fee created successfully', fee: insert.rows[0] });
  } catch (err) {
    console.error('createFee error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};
