import type { Request, Response } from 'express';
import supabase from '../../config/connectSupabase.js';

type BatchRow = {
  id: string;
  tution_id: string;
  name: string;
  code: string;
  subject: string | null;
  description: string | null;
  schedule: string | null;
  start_date: string;
  end_date: string | null;
  created_at: string;
};

type TeacherUserRow = {
  id: string;
  name: string;
  username: string;
  email: string;
  profile_photo: string | null;
};

type BatchTeacherLink = {
  teacher_user_id: string;
  is_lead: boolean;
};

type BatchStudentRow = {
  student_id: string;
  joined_at: string;
};

type StudentUserRow = {
  id: string;
  name: string;
  username: string;
  email: string;
  profile_photo: string | null;
};

type StudentProfileRow = {
  user_id: string;
  enrollment_number: string;
  grade_level: string | null;
  section: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const batchDetails = async (req: Request, res: Response): Promise<void> => {
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

    const batchId = req.params.batchId as string | undefined;
    if (!batchId) {
      res.status(400).json({ msg: 'batchId param is required' });
      return;
    }
    if (!UUID_RE.test(batchId)) {
      res.status(400).json({ msg: 'batchId must be a valid UUID' });
      return;
    }

    const { data: batch, error: batchErr } = await supabase
      .from('batches')
      .select(
        'id, tution_id, name, code, subject, description, schedule, start_date, end_date, created_at'
      )
      .eq('id', batchId)
      .eq('tution_id', tution_id)
      .single<BatchRow>();

    if (batchErr) {
      if (batchErr.code === 'PGRST116') {
        res.status(404).json({ msg: 'Batch not found' });
        return;
      }
      console.error('batchDetails: batch lookup failed:', batchErr);
      res.status(500).json({ msg: 'Server error' });
      return;
    }

    let institution_name: string | null = null;
    const { data: tutionRow, error: tutionErr } = await supabase
      .from('tutions')
      .select('name')
      .eq('id', batch.tution_id)
      .maybeSingle<{ name: string }>();

    if (tutionErr) {
      console.error('batchDetails: tution lookup failed:', tutionErr);
      res.status(500).json({ msg: 'Server error' });
      return;
    }
    if (tutionRow) {
      institution_name = tutionRow.name;
    }

    const { data: teacherLinks, error: teacherLinksErr } = await supabase
      .from('batch_teachers')
      .select('teacher_user_id, is_lead')
      .eq('batch_id', batch.id);

    if (teacherLinksErr) {
      console.error('batchDetails: batch_teachers lookup failed:', teacherLinksErr);
      res.status(500).json({ msg: 'Server error' });
      return;
    }

    const teacherLinkRows = (teacherLinks ?? []) as BatchTeacherLink[];
    const teacherIds = teacherLinkRows.map((t) => t.teacher_user_id);
    const isLeadMap = new Map<string, boolean>(teacherLinkRows.map((t) => [t.teacher_user_id, t.is_lead]));

    let teachers: Array<{
      id: string;
      name: string;
      username: string;
      email: string;
      profile_photo: string | null;
      is_lead: boolean;
    }> = [];

    if (teacherIds.length > 0) {
      const { data: teacherUsers, error: teacherErr } = await supabase
        .from('users')
        .select('id, name, username, email, profile_photo')
        .eq('tution_id', batch.tution_id)
        .eq('role', 'teacher')
        .in('id', teacherIds);

      if (teacherErr) {
        console.error('batchDetails: teacher lookup failed:', teacherErr);
        res.status(500).json({ msg: 'Server error' });
        return;
      }

      teachers = ((teacherUsers ?? []) as TeacherUserRow[])
        .map((u) => ({
          id: u.id,
          name: u.name,
          username: u.username,
          email: u.email,
          profile_photo: u.profile_photo,
          is_lead: isLeadMap.get(u.id) ?? false
        }))
        .sort((a, b) => (b.is_lead ? 1 : 0) - (a.is_lead ? 1 : 0) || a.name.localeCompare(b.name));
    }

    const { data: batchStudents, error: batchStudentsErr } = await supabase
      .from('batch_students')
      .select('student_id, joined_at')
      .eq('batch_id', batch.id);

    if (batchStudentsErr) {
      console.error('batchDetails: batch_students lookup failed:', batchStudentsErr);
      res.status(500).json({ msg: 'Server error' });
      return;
    }

    const studentLinks = (batchStudents ?? []) as BatchStudentRow[];
    const studentIds = studentLinks.map((row) => row.student_id);
    const joinedAtMap = new Map<string, string>();
    for (const row of studentLinks) {
      joinedAtMap.set(row.student_id, row.joined_at);
    }

    let students: Array<{
      id: string;
      name: string;
      username: string;
      email: string;
      profile_photo: string | null;
      enrollment_number: string | null;
      grade_level: string | null;
      section: string | null;
      guardian_name: string | null;
      guardian_phone: string | null;
      joined_at: string | null;
    }> = [];

    if (studentIds.length > 0) {
      const { data: studentUsers, error: studentUsersErr } = await supabase
        .from('users')
        .select('id, name, username, email, profile_photo')
        .eq('tution_id', batch.tution_id)
        .eq('role', 'student')
        .in('id', studentIds);

      if (studentUsersErr) {
        console.error('batchDetails: student users lookup failed:', studentUsersErr);
        res.status(500).json({ msg: 'Server error' });
        return;
      }

      const { data: studentProfiles, error: studentProfilesErr } = await supabase
        .from('students')
        .select('user_id, enrollment_number, grade_level, section, guardian_name, guardian_phone')
        .eq('tution_id', batch.tution_id)
        .in('user_id', studentIds);

      if (studentProfilesErr) {
        console.error('batchDetails: student profiles lookup failed:', studentProfilesErr);
        res.status(500).json({ msg: 'Server error' });
        return;
      }

      const profilesMap = new Map<string, StudentProfileRow>();
      for (const profile of (studentProfiles ?? []) as StudentProfileRow[]) {
        profilesMap.set(profile.user_id, profile);
      }

      students = ((studentUsers ?? []) as StudentUserRow[]).map((user) => {
        const profile = profilesMap.get(user.id);
        return {
          id: user.id,
          name: user.name,
          username: user.username,
          email: user.email,
          profile_photo: user.profile_photo,
          enrollment_number: profile?.enrollment_number ?? null,
          grade_level: profile?.grade_level ?? null,
          section: profile?.section ?? null,
          guardian_name: profile?.guardian_name ?? null,
          guardian_phone: profile?.guardian_phone ?? null,
          joined_at: joinedAtMap.get(user.id) ?? null
        };
      });
    }

    res.status(200).json({
      batch: {
        id: batch.id,
        name: batch.name,
        code: batch.code,
        subject: batch.subject,
        description: batch.description,
        schedule: batch.schedule,
        start_date: batch.start_date,
        end_date: batch.end_date,
        created_at: batch.created_at,
        institution_name,
        teachers,
        student_count: students.length,
        students
      }
    });
  } catch (err) {
    console.error('batchDetails error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};
