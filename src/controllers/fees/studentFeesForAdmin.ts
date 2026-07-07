import type { Request, Response } from 'express';
import pool from '../../config/connectpsql.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface StudentRow {
  id: string;
  name: string;
  username: string;
  profile_photo: string | null;
  enrollment_number: string | null;
  grade_level: string | null;
  section: string | null;
}

interface FeeRow {
  id: string;
  title: string;
  description: string | null;
  amount_cents: string;
  paid_cents: string;
  currency: string;
  due_date: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface PaymentRow {
  id: string;
  fee_id: string;
  amount_cents: string;
  method: string;
  reference: string | null;
  notes: string | null;
  paid_at: string;
  recorded_by: string;
  recorded_by_name: string | null;
  created_at: string;
}

// =============================================================================
// GET /api/v1/admin/fees/students/:studentId
//   admin only. Drill-down for a single student's fees: profile, every fee
//   they've been issued, and every payment recorded. Used when the admin
//   clicks a row in the fees-students table.
//
// Response:
// {
//   student: {...},
//   totals: { total_amount_cents, paid_cents, pending_cents, status },
//   fees: [
//     { id, title, ..., amount_cents, paid_cents, pending_cents,
//       currency, due_date, status, created_at, updated_at,
//       payments: [...] }
//   ]
// }
// =============================================================================
export const studentFeesForAdmin = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ msg: 'Authentication required' });
    return;
  }
  const tution_id = req.user.tution_id;
  if (!tution_id) {
    res.status(400).json({ msg: 'Token has no tution_id' });
    return;
  }

  const studentId = (req.params.studentId as string | undefined) ?? '';
  if (!UUID_RE.test(studentId)) {
    res.status(400).json({ msg: 'studentId must be a valid UUID' });
    return;
  }

  try {
    const studentResult = await pool.query<StudentRow>(
      `SELECT u.id, u.name, u.username, u.profile_photo,
              s.enrollment_number, s.grade_level, s.section
         FROM users u
         LEFT JOIN students s ON s.user_id = u.id
        WHERE u.id = $1
          AND u.tution_id = $2
          AND u.role = 'student'`,
      [studentId, tution_id]
    );
    if (studentResult.rowCount === 0) {
      res.status(404).json({ msg: 'Student not found in this institution' });
      return;
    }
    const student = studentResult.rows[0]!;

    const feesResult = await pool.query<FeeRow>(
      `SELECT id, title, description, amount_cents, paid_cents, currency,
              due_date, status, created_at, updated_at
         FROM fees
        WHERE tution_id = $1 AND student_id = $2
        ORDER BY (status = 'pending') DESC,
                 (status = 'partial') DESC,
                 due_date ASC NULLS LAST,
                 created_at DESC`,
      [tution_id, studentId]
    );

    const feeIds = feesResult.rows.map((f) => f.id);
    let payments: PaymentRow[] = [];
    if (feeIds.length > 0) {
      const paymentsResult = await pool.query<PaymentRow>(
        `SELECT p.id, p.fee_id, p.amount_cents, p.method, p.reference, p.notes,
                p.paid_at, p.recorded_by,
                ru.name AS recorded_by_name,
                p.created_at
           FROM fee_payments p
           LEFT JOIN users ru ON ru.id = p.recorded_by
          WHERE p.tution_id = $1
            AND p.fee_id = ANY($2::uuid[])
          ORDER BY p.paid_at DESC, p.created_at DESC`,
        [tution_id, feeIds]
      );
      payments = paymentsResult.rows;
    }

    const paymentsByFee = new Map<string, PaymentRow[]>();
    for (const p of payments) {
      const list = paymentsByFee.get(p.fee_id) ?? [];
      list.push(p);
      paymentsByFee.set(p.fee_id, list);
    }

    let total_amount_cents = 0;
    let paid_cents_total = 0;
    let currency = 'INR';

    const fees = feesResult.rows.map((f) => {
      const amount = Number(f.amount_cents);
      const paid = Number(f.paid_cents);
      if (f.status !== 'cancelled') {
        total_amount_cents += amount;
        paid_cents_total += paid;
      }
      currency = f.currency;
      return {
        id: f.id,
        title: f.title,
        description: f.description,
        amount_cents: amount,
        paid_cents: paid,
        pending_cents: amount - paid,
        currency: f.currency,
        due_date: f.due_date,
        status: f.status,
        created_at: f.created_at,
        updated_at: f.updated_at,
        payments: (paymentsByFee.get(f.id) ?? []).map((p) => ({
          id: p.id,
          amount_cents: Number(p.amount_cents),
          method: p.method,
          reference: p.reference,
          notes: p.notes,
          paid_at: p.paid_at,
          recorded_by: { id: p.recorded_by, name: p.recorded_by_name },
          created_at: p.created_at
        }))
      };
    });

    const pending_cents_total = total_amount_cents - paid_cents_total;
    const nonCancelledFees = fees.filter((f) => f.status !== 'cancelled').length;
    let rowStatus: 'none' | 'paid' | 'partial' | 'pending';
    if (nonCancelledFees === 0) rowStatus = 'none';
    else if (paid_cents_total >= total_amount_cents) rowStatus = 'paid';
    else if (paid_cents_total > 0) rowStatus = 'partial';
    else rowStatus = 'pending';

    res.status(200).json({
      student: {
        id: student.id,
        name: student.name,
        username: student.username,
        profile_photo: student.profile_photo,
        enrollment_number: student.enrollment_number,
        grade_level: student.grade_level,
        section: student.section
      },
      totals: {
        total_amount_cents,
        paid_cents: paid_cents_total,
        pending_cents: pending_cents_total,
        currency,
        status: rowStatus,
        fees_count: nonCancelledFees
      },
      fees
    });
  } catch (err) {
    console.error('studentFeesForAdmin error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};
