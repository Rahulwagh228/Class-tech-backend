import type { Request, Response } from 'express';
import supabase from '../../config/connectSupabase.js';

interface ParentLinkRow {
  student_user_id: string;
  relationship: string | null;
  is_primary: boolean;
}

interface UserRow {
  id: string;
  name: string;
  username: string;
  profile_photo: string | null;
}

interface StudentProfileRow {
  user_id: string;
  enrollment_number: string;
  grade_level: string | null;
  section: string | null;
}

// =============================================================================
// GET /api/v1/parents/me/children
//
// Returns the list of student users linked to the calling parent. Auth
// is just role='parent' - we look up the link table by req.user.id.
// Use this to populate the child-picker on the parent dashboard, then drill
// into per-child views via /api/v1/attendance/students/:studentId/...
// =============================================================================
export const listChildren = async (req: Request, res: Response): Promise<void> => {
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

    const { data: links, error: linksErr } = await supabase
      .from('parent_students')
      .select('student_user_id, relationship, is_primary')
      .eq('parent_user_id', req.user.id)
      .eq('tution_id', tution_id);

    if (linksErr) {
      console.error('listChildren: link lookup failed:', linksErr);
      res.status(500).json({ msg: 'Server error' });
      return;
    }

    const linkRows = (links ?? []) as ParentLinkRow[];
    const studentIds = linkRows.map((l) => l.student_user_id);
    if (studentIds.length === 0) {
      res.status(200).json({ children: [] });
      return;
    }

    const [{ data: users, error: usersErr }, { data: profiles, error: profilesErr }] = await Promise.all([
      supabase
        .from('users')
        .select('id, name, username, profile_photo')
        .eq('tution_id', tution_id)
        .eq('role', 'student')
        .in('id', studentIds),
      supabase
        .from('students')
        .select('user_id, enrollment_number, grade_level, section')
        .eq('tution_id', tution_id)
        .in('user_id', studentIds)
    ]);

    if (usersErr) {
      console.error('listChildren: user lookup failed:', usersErr);
      res.status(500).json({ msg: 'Server error' });
      return;
    }
    if (profilesErr) {
      console.error('listChildren: profile lookup failed:', profilesErr);
      res.status(500).json({ msg: 'Server error' });
      return;
    }

    const userMap = new Map<string, UserRow>();
    for (const u of (users ?? []) as UserRow[]) userMap.set(u.id, u);
    const profileMap = new Map<string, StudentProfileRow>();
    for (const p of (profiles ?? []) as StudentProfileRow[]) profileMap.set(p.user_id, p);

    const children = linkRows
      .map((l) => {
        const u = userMap.get(l.student_user_id);
        const p = profileMap.get(l.student_user_id);
        if (!u) return null;
        return {
          student_id: u.id,
          name: u.name,
          username: u.username,
          profile_photo: u.profile_photo,
          enrollment_number: p?.enrollment_number ?? null,
          grade_level: p?.grade_level ?? null,
          section: p?.section ?? null,
          relationship: l.relationship,
          is_primary: l.is_primary
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0) || a.name.localeCompare(b.name));

    res.status(200).json({ children });
  } catch (err) {
    console.error('listChildren error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};
