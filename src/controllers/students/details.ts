import type { Request, Response } from 'express';
import supabase from '../../config/connectSupabase.js';

// =============================================================================
// GET /api/v1/students/:studentId   (auth required, admin or teacher)
//
// Returns the FULL profile of a single student by joining the `users` and
// `students` tables.  The studentId param is the `user_id` (UUID) which is
// the PK of students and the FK into users.
//
// Security:
//   - The query is scoped to the caller's tution_id (from JWT) so an admin
//     from one tution can never read a student from another tution.
//
// Response shape:
//   { data: { ...all user + student fields } }
// =============================================================================

export const studentDetails = async (req: Request, res: Response): Promise<void> => {
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

    const studentId = req.params.studentId as string | undefined;
    if (!studentId) {
      res.status(400).json({ msg: 'studentId param is required' });
      return;
    }

    // UUID format check (basic)
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(studentId)) {
      res.status(400).json({ msg: 'studentId must be a valid UUID' });
      return;
    }

    // ── Join students ← users via the FK on students.user_id ─────────────
    const { data, error } = await supabase
      .from('students')
      .select(
        `
          user_id,
          enrollment_number,
          date_of_birth,
          gender,
          grade_level,
          section,
          blood_group,
          guardian_name,
          guardian_phone,
          emergency_contact,
          address,
          admission_date,
          notes,
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
      .eq('user_id', studentId)
      .eq('tution_id', tution_id)
      .single();

    if (error) {
      // PostgREST returns code PGRST116 when .single() finds 0 rows
      if (error.code === 'PGRST116') {
        res.status(404).json({ msg: 'Student not found' });
        return;
      }
      console.error('studentDetails error:', error);
      res.status(500).json({ msg: error.message });
      return;
    }

    // ── Flatten the embedded users object into a single-level response ───
    type RawRow = {
      user_id: string;
      enrollment_number: string;
      date_of_birth: string | null;
      gender: string | null;
      grade_level: string | null;
      section: string | null;
      blood_group: string | null;
      guardian_name: string | null;
      guardian_phone: string | null;
      emergency_contact: string | null;
      address: string | null;
      admission_date: string | null;
      notes: string | null;
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

      // ── Student fields ──
      enrollment_number: row.enrollment_number,
      date_of_birth: row.date_of_birth,
      gender: row.gender,
      grade_level: row.grade_level,
      section: row.section,
      blood_group: row.blood_group,
      guardian_name: row.guardian_name,
      guardian_phone: row.guardian_phone,
      emergency_contact: row.emergency_contact,
      address: row.address,
      admission_date: row.admission_date,
      notes: row.notes,

      // ── Timestamps ──
      account_created_at: user?.created_at ?? null,
      account_updated_at: user?.updated_at ?? null,
      student_created_at: row.created_at,
      student_updated_at: row.updated_at
    };

    res.json({ data: flat });
  } catch (err) {
    console.error('studentDetails error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};
