import type { Request, Response } from 'express';
import pool from '../../../config/connectpsql.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type BatchStudentRow = {
  id: string;
  batch_id: string;
  student_id: string;
  joined_at: string;
};

// =============================================================================
// POST /api/v1/batches/:batchId/students
//
// Add one or more students to an existing batch. Idempotent: students already
// enrolled are reported under `already_enrolled` rather than erroring.
//
// Implementation note:
//   This endpoint deliberately bypasses the Supabase JS client and talks to
//   Postgres directly through `pg`. The intent is to keep the door open for
//   migrating off Supabase later by writing portable SQL here, while still
//   pointing DATABASE_URL at the Supabase Postgres instance for now.
//
// Auth: admin OR a teacher assigned to this batch (enforced by
//       requireBatchAccess - that middleware attaches req.batch).
//
// Body: { student_ids: ["uuid", ...] }
// Response: { msg, batch_id, added: [...], already_enrolled: [...] }
// =============================================================================
export const addStudentsToBatch = async (req: Request, res: Response): Promise<void> => {
  // Reuse one pooled connection for the whole flow so the three queries run
  // against the same backend - cheaper than borrowing from the pool 3 times.
  const client = await pool.connect();
  try {
    if (!req.user) {
      res.status(401).json({ msg: 'Authentication required' });
      return;
    }
    const tution_id = req.user.tution_id;
    const batch = req.batch;
    if (!batch) {
      res.status(500).json({ msg: 'Batch context missing' });
      return;
    }

    // -------------------------------------------------------------------------
    // Parse + validate body
    // -------------------------------------------------------------------------
    const body = (req.body ?? {}) as Record<string, unknown>;
    const raw = body.student_ids;

    if (!Array.isArray(raw) || raw.length === 0) {
      res.status(400).json({ msg: 'student_ids must be a non-empty array of UUID strings' });
      return;
    }

    const idSet = new Set<string>();
    for (const value of raw) {
      if (typeof value !== 'string') {
        res.status(400).json({ msg: 'student_ids must contain only strings' });
        return;
      }
      const trimmed = value.trim();
      if (!UUID_RE.test(trimmed)) {
        res.status(400).json({ msg: `student_ids contains an invalid UUID: ${trimmed}` });
        return;
      }
      idSet.add(trimmed);
    }
    const student_ids = Array.from(idSet);

    // -------------------------------------------------------------------------
    // 1. Verify each id is a student in this tution.
    //    Use `id = ANY($2::uuid[])` so we can bind the whole array in one shot.
    // -------------------------------------------------------------------------
    const validRes = await client.query<{ id: string }>(
      `SELECT id
         FROM users
        WHERE tution_id = $1
          AND role      = 'student'
          AND id        = ANY($2::uuid[])`,
      [tution_id, student_ids]
    );

    const validIds = new Set(validRes.rows.map((r) => r.id));
    const invalidIds = student_ids.filter((id) => !validIds.has(id));
    if (invalidIds.length > 0) {
      res.status(400).json({
        msg: 'One or more student_ids are invalid or do not belong to this tution',
        invalid_student_ids: invalidIds
      });
      return;
    }

    // -------------------------------------------------------------------------
    // 2. Find who's already in the batch so the insert stays idempotent.
    // -------------------------------------------------------------------------
    const existingRes = await client.query<{ student_id: string }>(
      `SELECT student_id
         FROM batch_students
        WHERE batch_id    = $1
          AND student_id  = ANY($2::uuid[])`,
      [batch.id, student_ids]
    );

    const alreadyEnrolled = new Set(existingRes.rows.map((r) => r.student_id));
    const toInsert = student_ids.filter((id) => !alreadyEnrolled.has(id));

    if (toInsert.length === 0) {
      res.status(200).json({
        msg: 'All supplied students were already enrolled in this batch',
        batch_id: batch.id,
        added: [],
        already_enrolled: Array.from(alreadyEnrolled)
      });
      return;
    }

    // -------------------------------------------------------------------------
    // 3. Bulk insert. Expand the array with `unnest` so we send a single
    //    parameterised statement regardless of how many ids there are.
    // -------------------------------------------------------------------------
    const insertRes = await client.query<BatchStudentRow>(
      `INSERT INTO batch_students (batch_id, student_id)
       SELECT $1, sid
         FROM unnest($2::uuid[]) AS sid
       RETURNING id, batch_id, student_id, joined_at`,
      [batch.id, toInsert]
    );

    res.status(201).json({
      msg: 'Students added to batch',
      batch_id: batch.id,
      added: insertRes.rows,
      already_enrolled: Array.from(alreadyEnrolled)
    });
  } catch (err) {
    console.error('addStudentsToBatch error:', err);
    res.status(500).json({ msg: (err as Error).message ?? 'Server error' });
  } finally {
    client.release();
  }
};
