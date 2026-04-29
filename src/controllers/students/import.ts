import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import * as XLSX from 'xlsx';
import supabase from '../../config/connectSupabase.js';
import { env } from '../../config/env.js';

// =============================================================================
// POST /api/v1/importStudent     (auth required)
// multipart/form-data:
//   file: .csv | .xlsx | .xls
//
// Required columns:  email, name, enrollment_number
// Optional columns:  password, date_of_birth, gender, grade_level, section,
//                    blood_group, guardian_name, guardian_phone,
//                    emergency_contact, address, admission_date, notes
//
// Behavior:
//   - tution_id comes from the JWT (req.user.tution_id), NOT the file.
//   - username  is auto-derived from the email local part: arya@x.com -> arya
//   - email_verified defaults to FALSE.
//   - If `password` column is missing, the enrollment_number is used as the
//     initial password. The admin should communicate this and force a reset.
//   - Duplicates inside the file (same email or same derived username) are
//     reported per-row and skipped.
//   - Pre-existing emails in the DB are reported per-row and skipped.
//   - Best-effort bulk insert. Returns a summary { imported, skipped, errors }.
// =============================================================================

interface ImportRow {
  rowNumber: number; // 2-indexed (header is row 1) - what the user sees in Excel
  email?: string;
  name?: string;
  enrollment_number?: string;
  password?: string;
  date_of_birth?: string;
  gender?: string;
  grade_level?: string;
  section?: string;
  blood_group?: string;
  guardian_name?: string;
  guardian_phone?: string;
  emergency_contact?: string;
  address?: string;
  admission_date?: string;
  notes?: string;
}

interface RowError {
  row: number;
  email?: string;
  reason: string;
}

function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

// Derive username from email local part. Strip characters that don't satisfy
// the users.username CHECK constraint (`^[a-zA-Z0-9_.-]{3,30}$`).
function usernameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? '';
  return local.replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 30);
}

function asString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const s = String(value).trim();
  return s.length === 0 ? undefined : s;
}

function parseSheet(buffer: Buffer): Record<string, unknown>[] {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) return [];
  const sheet = wb.Sheets[firstSheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
}

export const importStudents = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ msg: 'Authentication required' });
      return;
    }
    const tution_id = req.user.tution_id;
    if (!tution_id) {
      res.status(400).json({ msg: 'Token has no tution_id; cannot import' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ msg: 'No file uploaded. Send multipart/form-data with field "file".' });
      return;
    }

    // -------------------------------------------------------------------------
    // 1. Parse the file
    // -------------------------------------------------------------------------
    let raw: Record<string, unknown>[];
    try {
      raw = parseSheet(req.file.buffer);
    } catch (err) {
      res.status(400).json({ msg: `Failed to parse file: ${(err as Error).message}` });
      return;
    }
    if (raw.length === 0) {
      res.status(400).json({ msg: 'File has no data rows' });
      return;
    }

    // -------------------------------------------------------------------------
    // 2. Validate + normalize each row, dedupe within file
    // -------------------------------------------------------------------------
    const errors: RowError[] = [];
    const seenEmails = new Set<string>();
    const seenUsernames = new Set<string>();
    const validRows: (ImportRow & {
      email: string;
      name: string;
      enrollment_number: string;
      username: string;
    })[] = [];

    raw.forEach((rec, idx) => {
      const rowNumber = idx + 2;
      const email = normalizeEmail(rec.email);
      const name = asString(rec.name);
      const enrollment_number = asString(rec.enrollment_number);

      if (!email) return errors.push({ row: rowNumber, reason: 'email is missing' });
      if (!name) return errors.push({ row: rowNumber, email, reason: 'name is missing' });
      if (!enrollment_number)
        return errors.push({ row: rowNumber, email, reason: 'enrollment_number is missing' });
      if (!email.includes('@'))
        return errors.push({ row: rowNumber, email, reason: 'email is malformed' });

      const username = usernameFromEmail(email);
      if (username.length < 3) {
        return errors.push({
          row: rowNumber,
          email,
          reason: `derived username "${username}" is shorter than 3 chars`
        });
      }

      if (seenEmails.has(email)) {
        return errors.push({ row: rowNumber, email, reason: 'duplicate email within file' });
      }
      if (seenUsernames.has(username)) {
        return errors.push({
          row: rowNumber,
          email,
          reason: `derived username "${username}" collides with another row in this file`
        });
      }
      seenEmails.add(email);
      seenUsernames.add(username);

      validRows.push({
        rowNumber,
        email,
        name,
        enrollment_number,
        username,
        password: asString(rec.password) ?? enrollment_number,
        date_of_birth: asString(rec.date_of_birth),
        gender: asString(rec.gender),
        grade_level: asString(rec.grade_level),
        section: asString(rec.section),
        blood_group: asString(rec.blood_group),
        guardian_name: asString(rec.guardian_name),
        guardian_phone: asString(rec.guardian_phone),
        emergency_contact: asString(rec.emergency_contact),
        address: asString(rec.address),
        admission_date: asString(rec.admission_date),
        notes: asString(rec.notes)
      });
    });

    if (validRows.length === 0) {
      res.status(400).json({ msg: 'No valid rows to import', errors });
      return;
    }

    // -------------------------------------------------------------------------
    // 3. Skip emails that already exist in the DB
    // -------------------------------------------------------------------------
    const emails = validRows.map((r) => r.email);
    const { data: existing, error: existingErr } = await supabase
      .from('users')
      .select('email')
      .in('email', emails);

    if (existingErr) {
      console.error('importStudents: existing-email check failed:', existingErr);
      res.status(500).json({ msg: 'Server error checking existing users' });
      return;
    }
    const existingEmails = new Set((existing ?? []).map((r: { email: string }) => r.email));
    const toInsert = validRows.filter((r) => {
      if (existingEmails.has(r.email)) {
        errors.push({ row: r.rowNumber, email: r.email, reason: 'email already exists in DB' });
        return false;
      }
      return true;
    });

    if (toInsert.length === 0) {
      res.status(409).json({ msg: 'All rows conflict with existing users', errors });
      return;
    }

    // -------------------------------------------------------------------------
    // 4. Hash passwords in parallel, then bulk insert into users
    // -------------------------------------------------------------------------
    const usersPayload = await Promise.all(
      toInsert.map(async (r) => ({
        tution_id,
        name: r.name,
        username: r.username,
        email: r.email,
        password_hash: await bcrypt.hash(r.password ?? r.enrollment_number, env.BCRYPT_ROUNDS),
        role: 'student' as const,
        email_verified: false
      }))
    );

    const { data: insertedUsers, error: userInsertErr } = await supabase
      .from('users')
      .insert(usersPayload)
      .select('id, email');

    if (userInsertErr || !insertedUsers) {
      console.error('importStudents: bulk user insert failed:', userInsertErr);
      res.status(500).json({
        msg: userInsertErr?.message ?? 'Failed to insert users',
        errors
      });
      return;
    }

    // Map email -> generated user id so we can link the students rows
    const idByEmail = new Map<string, string>();
    for (const u of insertedUsers as { id: string; email: string }[]) {
      idByEmail.set(u.email.toLowerCase(), u.id);
    }

    // -------------------------------------------------------------------------
    // 5. Bulk insert into students. If this fails we delete the just-created
    //    user rows so we never end up with orphan auth accounts.
    // -------------------------------------------------------------------------
    const studentsPayload = toInsert
      .map((r) => {
        const user_id = idByEmail.get(r.email);
        if (!user_id) return null;
        return {
          user_id,
          tution_id,
          enrollment_number: r.enrollment_number,
          date_of_birth: r.date_of_birth ?? null,
          gender: r.gender ?? null,
          grade_level: r.grade_level ?? null,
          section: r.section ?? null,
          blood_group: r.blood_group ?? null,
          guardian_name: r.guardian_name ?? null,
          guardian_phone: r.guardian_phone ?? null,
          emergency_contact: r.emergency_contact ?? null,
          address: r.address ?? null,
          admission_date: r.admission_date ?? null,
          notes: r.notes ?? null
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    const { error: studentInsertErr } = await supabase.from('students').insert(studentsPayload);

    if (studentInsertErr) {
      console.error('importStudents: bulk student insert failed:', studentInsertErr);
      const idsToRollback = Array.from(idByEmail.values());
      await supabase.from('users').delete().in('id', idsToRollback);
      res.status(500).json({
        msg: studentInsertErr.message,
        hint:
          'student insert failed - rolled back the user rows. Common causes: ' +
          'duplicate enrollment_number within this tution.',
        errors
      });
      return;
    }

    // -------------------------------------------------------------------------
    // 6. Success
    // -------------------------------------------------------------------------
    res.status(201).json({
      imported: studentsPayload.length,
      skipped: errors.length,
      errors,
      tution_id
    });
  } catch (err) {
    console.error('importStudents error:', err);
    res.status(500).json({ msg: 'Server error during import' });
  }
};
