import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import * as XLSX from 'xlsx';
import supabase from '../../config/connectSupabase.js';
import { env } from '../../config/env.js';

// =============================================================================
// TWO-STEP STUDENT IMPORT (User-Defined Column Mapping)
//
// Step 1 — POST /api/v1/importStudent/preview   (multipart: file)
//   • Parses the first sheet of the uploaded Excel/CSV.
//   • Extracts headers (column names).
//   • Stores the raw file buffer in a temporary in-memory store keyed by a
//     random file_id (auto-expires after 15 min).
//   • Returns { file_id, headers, totalRows }.
//
// Step 2 — POST /api/v1/importStudent/import     (JSON body)
//   Body: { file_id, mapping }
//   mapping is an object like:
//     {
//       "email":             "Student Email",
//       "name":              "Full Name",
//       "enrollment_number": "Roll No",
//       "password":          "Password",
//       "date_of_birth":     "DOB",
//       ...
//     }
//   Keys   = internal field names (email, name, enrollment_number, etc.)
//   Values = the Excel header the user picked in the UI.
//
// Behavior:
//   - tution_id comes from the JWT (req.user.tution_id), NOT the file.
//   - username is auto-derived from the email local part.
//   - email_verified defaults to FALSE.
//   - If `password` is not mapped (or the cell is empty), enrollment_number
//     is used as the initial password.
//   - Duplicate emails / usernames (within the file OR already in DB) are
//     SKIPPED — never cause the whole import to fail.
//   - Returns { imported, skipped, errors[] }.
// =============================================================================

// ─── Temp file store ────────────────────────────────────────────────────────

interface StoredFile {
  buffer: Buffer;
  originalName: string;
  createdAt: number;
}

const FILE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const pendingFiles = new Map<string, StoredFile>();

/** Purge expired files (runs lazily on every store/get). */
function purgeExpired(): void {
  const now = Date.now();
  for (const [id, entry] of pendingFiles) {
    if (now - entry.createdAt > FILE_TTL_MS) pendingFiles.delete(id);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

interface RowError {
  row: number;
  email?: string;
  reason: string;
}

function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/** Derive username from email local part.  Strips chars that don't satisfy
 *  the users.username CHECK constraint (`^[a-zA-Z0-9_.-]{3,30}$`). */
function usernameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? '';
  return local.replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 30);
}

function asString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const s = String(value).trim();
  return s.length === 0 ? undefined : s;
}

function parseSheet(buffer: Buffer): { headers: string[]; rows: Record<string, unknown>[] } {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) return { headers: [], rows: [] };
  const sheet = wb.Sheets[firstSheetName];
  if (!sheet) return { headers: [], rows: [] };

  // Extract headers from the first row
  const headers: string[] = [];
  const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1');
  for (let col = range.s.c; col <= range.e.c; col++) {
    const cellAddr = XLSX.utils.encode_cell({ r: range.s.r, c: col });
    const cell = sheet[cellAddr];
    headers.push(cell ? String(cell.v).trim() : `Column_${col + 1}`);
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  return { headers, rows };
}

// All internal field names the user can map to
const ALLOWED_FIELDS = new Set([
  'email',
  'name',
  'enrollment_number',
  'password',
  'date_of_birth',
  'gender',
  'grade_level',
  'section',
  'blood_group',
  'guardian_name',
  'guardian_phone',
  'emergency_contact',
  'address',
  'admission_date',
  'notes'
]);

const REQUIRED_FIELDS = ['email', 'name', 'enrollment_number'] as const;

// ─── Step 1: Preview ────────────────────────────────────────────────────────

export const previewImport = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ msg: 'Authentication required' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ msg: 'No file uploaded. Send multipart/form-data with field "file".' });
      return;
    }

    // Parse headers only
    let headers: string[];
    let totalRows: number;
    try {
      const parsed = parseSheet(req.file.buffer);
      headers = parsed.headers;
      totalRows = parsed.rows.length;
    } catch (err) {
      res.status(400).json({ msg: `Failed to parse file: ${(err as Error).message}` });
      return;
    }

    if (headers.length === 0) {
      res.status(400).json({ msg: 'File has no columns / headers' });
      return;
    }

    // Store the file buffer temporarily
    purgeExpired();
    const fileId = crypto.randomUUID();
    pendingFiles.set(fileId, {
      buffer: req.file.buffer,
      originalName: req.file.originalname,
      createdAt: Date.now()
    });

    res.status(200).json({
      file_id: fileId,
      headers,
      total_rows: totalRows,
      required_fields: [...REQUIRED_FIELDS],
      optional_fields: [...ALLOWED_FIELDS].filter(
        (f) => !(REQUIRED_FIELDS as readonly string[]).includes(f)
      )
    });
  } catch (err) {
    console.error('previewImport error:', err);
    res.status(500).json({ msg: 'Server error during preview' });
  }
};

// ─── Step 2: Import with mapping ────────────────────────────────────────────

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

    // ── Validate request body ────────────────────────────────────────────────
    const { file_id, mapping } = req.body as {
      file_id?: string;
      mapping?: Record<string, string>;
    };

    if (!file_id) {
      res.status(400).json({ msg: 'file_id is required' });
      return;
    }
    if (!mapping || typeof mapping !== 'object') {
      res.status(400).json({ msg: 'mapping is required and must be an object' });
      return;
    }

    // Validate that all required fields are present in the mapping
    const missingRequired = REQUIRED_FIELDS.filter((f) => !mapping[f]);
    if (missingRequired.length > 0) {
      res.status(400).json({
        msg: `Missing required field mappings: ${missingRequired.join(', ')}`,
        missing: missingRequired
      });
      return;
    }

    // Validate that all mapping keys are known field names
    const unknownFields = Object.keys(mapping).filter((k) => !ALLOWED_FIELDS.has(k));
    if (unknownFields.length > 0) {
      res.status(400).json({
        msg: `Unknown field names in mapping: ${unknownFields.join(', ')}`,
        unknown: unknownFields
      });
      return;
    }

    // ── Retrieve stored file ─────────────────────────────────────────────────
    purgeExpired();
    const storedFile = pendingFiles.get(file_id);
    if (!storedFile) {
      res.status(404).json({
        msg: 'File not found or expired. Please re-upload via the preview endpoint.'
      });
      return;
    }
    // Remove from store after retrieval (single use)
    pendingFiles.delete(file_id);

    // ── Parse the file ───────────────────────────────────────────────────────
    let raw: Record<string, unknown>[];
    try {
      const parsed = parseSheet(storedFile.buffer);
      raw = parsed.rows;
    } catch (err) {
      res.status(400).json({ msg: `Failed to parse file: ${(err as Error).message}` });
      return;
    }
    if (raw.length === 0) {
      res.status(400).json({ msg: 'File has no data rows' });
      return;
    }

    // ── Apply mapping: translate Excel column names → internal field names ──
    const mappedRows = raw.map((rec) => {
      const mapped: Record<string, unknown> = {};
      for (const [internalField, excelHeader] of Object.entries(mapping)) {
        mapped[internalField] = rec[excelHeader];
      }
      return mapped;
    });

    // ── Validate + normalize each row, dedupe within file ────────────────────
    const errors: RowError[] = [];
    const seenEmails = new Set<string>();
    const seenUsernames = new Set<string>();
    const validRows: {
      rowNumber: number;
      email: string;
      name: string;
      enrollment_number: string;
      username: string;
      password: string;
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
    }[] = [];

    mappedRows.forEach((rec, idx) => {
      const rowNumber = idx + 2; // header is row 1 in Excel
      const email = normalizeEmail(rec.email);
      const name = asString(rec.name);
      const enrollment_number = asString(rec.enrollment_number);

      if (!email) return errors.push({ row: rowNumber, reason: 'email is missing or empty' });
      if (!name) return errors.push({ row: rowNumber, email, reason: 'name is missing or empty' });
      if (!enrollment_number)
        return errors.push({ row: rowNumber, email, reason: 'enrollment_number is missing or empty' });
      if (!email.includes('@'))
        return errors.push({ row: rowNumber, email, reason: 'email is malformed (no @)' });

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
      res.status(400).json({ msg: 'No valid rows to import after applying mapping', errors });
      return;
    }

    // ── Skip emails / usernames that already exist in the DB ─────────────────
    const emails = validRows.map((r) => r.email);
    const usernames = validRows.map((r) => r.username);

    const [{ data: existingByEmail, error: emailCheckErr }, { data: existingByUsername, error: usernameCheckErr }] =
      await Promise.all([
        supabase.from('users').select('email').in('email', emails),
        supabase.from('users').select('username').in('username', usernames)
      ]);

    if (emailCheckErr || usernameCheckErr) {
      console.error('importStudents: existing-user check failed:', emailCheckErr ?? usernameCheckErr);
      res.status(500).json({ msg: 'Server error checking existing users' });
      return;
    }

    const existingEmails = new Set((existingByEmail ?? []).map((r: { email: string }) => r.email));
    const existingUsernames = new Set(
      (existingByUsername ?? []).map((r: { username: string }) => r.username)
    );

    const toInsert = validRows.filter((r) => {
      if (existingEmails.has(r.email)) {
        errors.push({ row: r.rowNumber, email: r.email, reason: 'email already exists in DB' });
        return false;
      }
      if (existingUsernames.has(r.username)) {
        errors.push({
          row: r.rowNumber,
          email: r.email,
          reason: `username "${r.username}" already exists in DB`
        });
        return false;
      }
      return true;
    });

    if (toInsert.length === 0) {
      res.status(409).json({ msg: 'All rows conflict with existing users', errors });
      return;
    }

    // ── Hash passwords in parallel, then bulk insert into users ──────────────
    const usersPayload = await Promise.all(
      toInsert.map(async (r) => ({
        tution_id,
        name: r.name,
        username: r.username,
        email: r.email,
        password_hash: await bcrypt.hash(r.password, env.BCRYPT_ROUNDS),
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

    // Map email → generated user id so we can link the students rows
    const idByEmail = new Map<string, string>();
    for (const u of insertedUsers as { id: string; email: string }[]) {
      idByEmail.set(u.email.toLowerCase(), u.id);
    }

    // ── Bulk insert into students ────────────────────────────────────────────
    // If this fails we delete the just-created user rows so we never end up
    // with orphan auth accounts.
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
          'student insert failed — rolled back the user rows. Common causes: ' +
          'duplicate enrollment_number within this tution.',
        errors
      });
      return;
    }

    // ── Success ──────────────────────────────────────────────────────────────
    res.status(201).json({
      imported: studentsPayload.length,
      skipped: errors.length,
      total: raw.length,
      errors,
      tution_id
    });
  } catch (err) {
    console.error('importStudents error:', err);
    res.status(500).json({ msg: 'Server error during import' });
  }
};
