import type { Request, Response } from 'express';
import supabase from '../../config/connectSupabase.js';

// =============================================================================
// GET /api/v1/teachers    (auth required, admin or teacher)
//
// Lists every teacher that belongs to the caller's tution. The tution scope
// is taken from the JWT (req.user.tution_id) and CANNOT be overridden via
// query string - prevents cross-tenant leaks.
//
// Query params (all optional):
//   specialization   exact match  e.g. "Mathematics"
//   gender           exact match  e.g. "male"
//   search           case-insensitive substring match against name OR
//                    employee_id
//   limit            default 50, max 200
//   offset           default 0
//
// Response shape:
//   { data: [...], total: <int>, limit, offset }
// =============================================================================
export const listTeachers = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ msg: 'Authentication required' });
      return;
    }
    const tution_id = req.user.tution_id;

    // ----- query params -----
    const specialization =
      typeof req.query.specialization === 'string' ? req.query.specialization : undefined;
    const gender = typeof req.query.gender === 'string' ? req.query.gender : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

    const rawLimit = Number(req.query.limit ?? 50);
    const rawOffset = Number(req.query.offset ?? 0);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50;
    const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0;

    // ----- build query -----
    // Pull the linked users row in the same trip via the FK on teachers.user_id.
    let query = supabase
      .from('teachers')
      .select(
        `
          user_id,
          employee_id,
          gender,
          qualification,
          specialization,
          experience_years,
          joining_date,
          phone,
          users:user_id ( name, email, profile_photo, email_verified )
        `,
        { count: 'exact' }
      )
      .eq('tution_id', tution_id);

    if (specialization) query = query.eq('specialization', specialization);
    if (gender) query = query.eq('gender', gender);
    if (search) {
      query = query.or(
        `employee_id.ilike.%${search}%,users.name.ilike.%${search}%`
      );
    }

    query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) {
      console.error('listTeachers error:', error);
      res.status(500).json({ msg: error.message });
      return;
    }

    // Flatten the embedded users row so the frontend gets a flat list.
    type Row = {
      user_id: string;
      employee_id: string;
      gender: string | null;
      qualification: string | null;
      specialization: string | null;
      experience_years: number | null;
      joining_date: string | null;
      phone: string | null;
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
      employee_id: r.employee_id,
      gender: r.gender,
      qualification: r.qualification,
      specialization: r.specialization,
      experience_years: r.experience_years,
      joining_date: r.joining_date,
      phone: r.phone
    }));

    res.json({
      data: flat,
      total: count ?? flat.length,
      limit,
      offset
    });
  } catch (err) {
    console.error('listTeachers error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};
