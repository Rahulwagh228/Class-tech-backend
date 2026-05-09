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
  teacher_id: string | null;
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
        'id, tution_id, name, code, subject, description, schedule, teacher_id, start_date, end_date, created_at'
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

    let teacher: {
      id: string;
      name: string;
      username: string;
      email: string;
      profile_photo: string | null;
    } | null = null;

    if (batch.teacher_id) {
      const { data: teacherUser, error: teacherErr } = await supabase
        .from('users')
        .select('id, name, username, email, profile_photo')
        .eq('id', batch.teacher_id)
        .eq('tution_id', batch.tution_id)
        .eq('role', 'teacher')
        .maybeSingle<TeacherUserRow>();

      if (teacherErr) {
        console.error('batchDetails: teacher lookup failed:', teacherErr);
        res.status(500).json({ msg: 'Server error' });
        return;
      }

      if (teacherUser) {
        teacher = {
          id: teacherUser.id,
          name: teacherUser.name,
          username: teacherUser.username,
          email: teacherUser.email,
          profile_photo: teacherUser.profile_photo
        };
      }
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
        teacher,
        student_count: students.length,
        students
      }
    });
  } catch (err) {
    console.error('batchDetails error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};
