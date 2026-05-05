import type { Request, Response } from 'express';
import supabase from '../../config/connectSupabase.js';

// =============================================================================
// GET /api/v1/teachers/:teacherId   (auth required, admin or teacher)
//
// Returns the FULL profile of a single teacher by joining the `users` and
// `teachers` tables. The teacherId param is the `user_id` (UUID) which is
// the PK of teachers and the FK into users.
//
// Security:
//   - The query is scoped to the caller's tution_id (from JWT) so an admin
//     from one tution can never read a teacher from another tution.
//
// Response shape:
//   { data: { ...all user + teacher fields } }
// =============================================================================

export const teacherDetails = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ msg: 'Authentication required' });
      return;
    }
    const tution_id = req.user.tution_id;
    if (!tution_id) {
      res.status(400).json({ msg: 'Token has no tution_id' });
      return;
    }

    const teacherId = req.params.teacherId as string | undefined;
    if (!teacherId) {
      res.status(400).json({ msg: 'teacherId param is required' });
      return;
    }

    // UUID format check (basic)
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(teacherId)) {
      res.status(400).json({ msg: 'teacherId must be a valid UUID' });
      return;
    }

    // ── Join teachers ← users via the FK on teachers.user_id ─────────────
    const { data, error } = await supabase
      .from('teachers')
      .select(
        `
          user_id,
          employee_id,
          date_of_birth,
          gender,
          qualification,
          specialization,
          experience_years,
          joining_date,
          bio,
          phone,
          address,
          created_at,
          updated_at,
          users:user_id (
            name,
            username,
            email,
            profile_photo,
            role,
            email_verified,
            created_at,
            updated_at
          )
        `
      )
      .eq('user_id', teacherId)
      .eq('tution_id', tution_id)
      .single();

    if (error) {
      // PostgREST returns code PGRST116 when .single() finds 0 rows
      if (error.code === 'PGRST116') {
        res.status(404).json({ msg: 'Teacher not found' });
        return;
      }
      console.error('teacherDetails error:', error);
      res.status(500).json({ msg: error.message });
      return;
    }

    // ── Flatten the embedded users object into a single-level response ───
    type RawRow = {
      user_id: string;
      employee_id: string;
      date_of_birth: string | null;
      gender: string | null;
      qualification: string | null;
      specialization: string | null;
      experience_years: number | null;
      joining_date: string | null;
      bio: string | null;
      phone: string | null;
      address: string | null;
      created_at: string;
      updated_at: string;
      users: {
        name: string;
        username: string;
        email: string;
        profile_photo: string | null;
        role: string;
        email_verified: boolean;
        created_at: string;
        updated_at: string;
      } | null;
    };

    const row = data as unknown as RawRow;
    const user = row.users;

    const flat = {
      // ── User fields ──
      id: row.user_id,
      name: user?.name ?? null,
      username: user?.username ?? null,
      email: user?.email ?? null,
      profile_photo: user?.profile_photo ?? null,
      role: user?.role ?? null,
      email_verified: user?.email_verified ?? false,

      // ── Teacher fields ──
      employee_id: row.employee_id,
      date_of_birth: row.date_of_birth,
      gender: row.gender,
      qualification: row.qualification,
      specialization: row.specialization,
      experience_years: row.experience_years,
      joining_date: row.joining_date,
      bio: row.bio,
      phone: row.phone,
      address: row.address,

      // ── Timestamps ──
      account_created_at: user?.created_at ?? null,
      account_updated_at: user?.updated_at ?? null,
      teacher_created_at: row.created_at,
      teacher_updated_at: row.updated_at
    };

    res.json({ data: flat });
  } catch (err) {
    console.error('teacherDetails error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};
