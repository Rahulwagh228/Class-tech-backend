import type { Request, Response } from 'express';
import supabase from '../../../config/connectSupabase.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface LinkRow {
  id: string;
  teacher_user_id: string;
  is_lead: boolean;
  assigned_at: string;
}

interface TeacherUser {
  id: string;
  name: string;
  username: string;
  email: string;
  profile_photo: string | null;
}

// =============================================================================
// GET /api/v1/batches/:batchId/teachers
//
// Lists every teacher currently assigned to a batch. Admin or any teacher
// assigned to the batch can call this.
// =============================================================================
export const listBatchTeachers = async (req: Request, res: Response): Promise<void> => {
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
    if (!batchId || !UUID_RE.test(batchId)) {
      res.status(400).json({ msg: 'batchId must be a valid UUID' });
      return;
    }

    // Verify the batch is in the caller's tution before doing anything else.
    const { data: batch, error: batchErr } = await supabase
      .from('batches')
      .select('id')
      .eq('id', batchId)
      .eq('tution_id', tution_id)
      .maybeSingle<{ id: string }>();
    if (batchErr) {
      console.error('listBatchTeachers: batch lookup failed:', batchErr);
      res.status(500).json({ msg: 'Server error' });
      return;
    }
    if (!batch) {
      res.status(404).json({ msg: 'Batch not found' });
      return;
    }

    const { data: links, error: linksErr } = await supabase
      .from('batch_teachers')
      .select('id, teacher_user_id, is_lead, assigned_at')
      .eq('batch_id', batchId)
      .order('is_lead', { ascending: false })
      .order('assigned_at', { ascending: true });
    if (linksErr) {
      console.error('listBatchTeachers: link lookup failed:', linksErr);
      res.status(500).json({ msg: 'Server error' });
      return;
    }

    const linkRows = (links ?? []) as LinkRow[];
    if (linkRows.length === 0) {
      res.status(200).json({ batch_id: batchId, teachers: [] });
      return;
    }

    const { data: users, error: usersErr } = await supabase
      .from('users')
      .select('id, name, username, email, profile_photo')
      .eq('tution_id', tution_id)
      .in('id', linkRows.map((l) => l.teacher_user_id));
    if (usersErr) {
      console.error('listBatchTeachers: user lookup failed:', usersErr);
      res.status(500).json({ msg: 'Server error' });
      return;
    }
    const userMap = new Map<string, TeacherUser>(
      ((users ?? []) as TeacherUser[]).map((u) => [u.id, u])
    );

    const teachers = linkRows.map((l) => {
      const u = userMap.get(l.teacher_user_id);
      return {
        assignment_id: l.id,
        teacher_id: l.teacher_user_id,
        name: u?.name ?? null,
        username: u?.username ?? null,
        email: u?.email ?? null,
        profile_photo: u?.profile_photo ?? null,
        is_lead: l.is_lead,
        assigned_at: l.assigned_at
      };
    });

    res.status(200).json({ batch_id: batchId, teachers });
  } catch (err) {
    console.error('listBatchTeachers error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};
