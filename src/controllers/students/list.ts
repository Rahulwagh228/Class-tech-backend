import type { Request, Response } from 'express';
import supabase from '../../config/connectSupabase.js';

// =============================================================================
// GET /api/v1/students    (auth required, admin or teacher)
//
// Lists / searches students that belong to the caller's tution. tution_id
// comes from the JWT and cannot be overridden by the client.
//
// Query params (all optional):
//   search        case-insensitive substring match against name
//                 OR enrollment_number
//   grade_level   exact match  e.g. "Grade 8"
//   section       exact match  e.g. "A"
//   limit         default 50, max 200
//   offset        default 0
//
// Implementation:
//   Base table is `users` so we can filter `name` directly. We INNER JOIN
//   to `students` so we only return rows that have a student profile.
//   When `search` is set we run TWO parallel queries (name match, and
//   enrollment_number match), union the results, then paginate the union.
//   This is reliable on PostgREST, where .or() across embedded tables is
//   not supported.
//
// Response: { data: [...flat rows...], total, limit, offset }
// =============================================================================

interface UserRow {
  id: string;
  name: string;
  email: string;
  profile_photo: string | null;
  email_verified: boolean;
  students:
    | {
        enrollment_number: string;
        gender: string | null;
        grade_level: string | null;
        section: string | null;
        guardian_name: string | null;
        guardian_phone: string | null;
        date_of_birth: string | null;
        admission_date: string | null;
        created_at: string;
      }
    | null;
}

function flatten(row: UserRow) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    profile_photo: row.profile_photo,
    email_verified: row.email_verified,
    enrollment_number: row.students?.enrollment_number ?? null,
    gender: row.students?.gender ?? null,
    grade_level: row.students?.grade_level ?? null,
    section: row.students?.section ?? null,
    guardian_name: row.students?.guardian_name ?? null,
    guardian_phone: row.students?.guardian_phone ?? null,
    date_of_birth: row.students?.date_of_birth ?? null,
    admission_date: row.students?.admission_date ?? null
  };
}

const STUDENT_SELECT = `
  id,
  name,
  email,
  profile_photo,
  email_verified,
  students!inner (
    enrollment_number,
    gender,
    grade_level,
    section,
    guardian_name,
    guardian_phone,
    date_of_birth,
    admission_date,
    created_at
  )
`;

export const listStudents = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ msg: 'Authentication required' });
      return;
    }
    const tution_id = req.user.tution_id;

    // ---- query params ----
    const grade_level =
      typeof req.query.grade_level === 'string' ? req.query.grade_level : undefined;
    const section = typeof req.query.section === 'string' ? req.query.section : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

    const rawLimit = Number(req.query.limit ?? 50);
    const rawOffset = Number(req.query.offset ?? 0);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50;
    const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0;

    // ---- search path ----
    if (search) {
      // 1. match by name on users (base table)
      let q1 = supabase
        .from('users')
        .select(STUDENT_SELECT)
        .eq('tution_id', tution_id)
        .eq('role', 'student')
        .ilike('name', `%${search}%`);
      if (grade_level) q1 = q1.eq('students.grade_level', grade_level);
      if (section) q1 = q1.eq('students.section', section);

      // 2. match by enrollment_number on students (embedded)
      let q2 = supabase
        .from('users')
        .select(STUDENT_SELECT)
        .eq('tution_id', tution_id)
        .eq('role', 'student')
        .ilike('students.enrollment_number', `%${search}%`);
      if (grade_level) q2 = q2.eq('students.grade_level', grade_level);
      if (section) q2 = q2.eq('students.section', section);

      const [r1, r2] = await Promise.all([q1, q2]);
      if (r1.error || r2.error) {
        console.error('listStudents search error:', r1.error ?? r2.error);
        res.status(500).json({ msg: (r1.error ?? r2.error)?.message ?? 'Server error' });
        return;
      }

      // Union by id, preserve insertion order (name matches first, then enrollment matches)
      const seen = new Set<string>();
      const merged: UserRow[] = [];
      for (const row of [...(r1.data ?? []), ...(r2.data ?? [])] as unknown as UserRow[]) {
        if (!seen.has(row.id)) {
          seen.add(row.id);
          merged.push(row);
        }
      }

      const total = merged.length;
      const page = merged.slice(offset, offset + limit).map(flatten);
      res.json({ data: page, total, limit, offset });
      return;
    }

    // ---- no search: simple paginated list ----
    let query = supabase
      .from('users')
      .select(STUDENT_SELECT, { count: 'exact' })
      .eq('tution_id', tution_id)
      .eq('role', 'student');
    if (grade_level) query = query.eq('students.grade_level', grade_level);
    if (section) query = query.eq('students.section', section);
    query = query.order('name', { ascending: true }).range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) {
      console.error('listStudents error:', error);
      res.status(500).json({ msg: error.message });
      return;
    }

    const flat = (data as unknown as UserRow[] | null ?? []).map(flatten);
    res.json({ data: flat, total: count ?? flat.length, limit, offset });
  } catch (err) {
    console.error('listStudents error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};
