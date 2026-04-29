import type { Request, Response } from 'express';
import supabase from '../../config/connectSupabase.js';

// =============================================================================
// GET /api/v1/students    (auth required, admin or teacher)
//
// Lists every student that belongs to the caller's tution. The tution scope
// is taken from the JWT (req.user.tution_id) and CANNOT be overridden via
// query string - prevents cross-tenant leaks.
//
// Query params (all optional):
//   grade_level   exact match  e.g. "Grade 8"
//   section       exact match  e.g. "A"
//   search        case-insensitive substring match against name OR
//                 enrollment_number
//   limit         default 50, max 200
//   offset        default 0
//
// Response shape:
//   { data: [...], total: <int>, limit, offset }
// =============================================================================
export const listStudents = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ msg: 'Authentication required' });
      return;
    }
    const tution_id = req.user.tution_id;

    // ----- query params -----
    const grade_level = typeof req.query.grade_level === 'string' ? req.query.grade_level : undefined;
    const section = typeof req.query.section === 'string' ? req.query.section : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

    const rawLimit = Number(req.query.limit ?? 50);
    const rawOffset = Number(req.query.offset ?? 0);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50;
    const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0;

    // ----- build query -----
    // PostgREST embed: pull the linked users row in the same trip via the
    // FK on students.user_id. The `users!user_id` syntax names the FK so
    // Supabase doesn't have to guess.
    let query = supabase
      .from('students')
      .select(
        `
          user_id,
          enrollment_number,
          gender,
          grade_level,
          section,
          guardian_name,
          guardian_phone,
          date_of_birth,
          admission_date,
          users:user_id ( name, email, profile_photo, email_verified )
        `,
        { count: 'exact' }
      )
      .eq('tution_id', tution_id);

    if (grade_level) query = query.eq('grade_level', grade_level);
    if (section) query = query.eq('section', section);
    if (search) {
      // matches name OR enrollment_number, case-insensitive
      query = query.or(
        `enrollment_number.ilike.%${search}%,users.name.ilike.%${search}%`
      );
    }

    query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) {
      console.error('listStudents error:', error);
      res.status(500).json({ msg: error.message });
      return;
    }

    // Flatten the embedded users row so the frontend gets a flat list -
    // easier to render in a <table>.
    type Row = {
      user_id: string;
      enrollment_number: string;
      gender: string | null;
      grade_level: string | null;
      section: string | null;
      guardian_name: string | null;
      guardian_phone: string | null;
      date_of_birth: string | null;
      admission_date: string | null;
      users:
        | {
            name: string;
            email: string;
            profile_photo: string | null;
            email_verified: boolean;
          }
        | null;
    };

    const flat = (data as unknown as Row[] | null ?? []).map((r) => ({
      id: r.user_id,
      name: r.users?.name ?? null,
      email: r.users?.email ?? null,
      profile_photo: r.users?.profile_photo ?? null,
      email_verified: r.users?.email_verified ?? false,
      enrollment_number: r.enrollment_number,
      gender: r.gender,
      grade_level: r.grade_level,
      section: r.section,
      guardian_name: r.guardian_name,
      guardian_phone: r.guardian_phone,
      date_of_birth: r.date_of_birth,
      admission_date: r.admission_date
    }));

    res.json({
      data: flat,
      total: count ?? flat.length,
      limit,
      offset
    });
  } catch (err) {
    console.error('listStudents error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};
