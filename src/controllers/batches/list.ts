import type { Request, Response } from 'express';
import supabase from '../../config/connectSupabase.js';

type BatchRow = {
  id: string;
  tution_id: string;
  name: string;
  code: string;
  start_date: string;
  end_date: string | null;
  created_at: string;
};

type BatchTeacherLink = {
  batch_id: string;
  teacher_user_id: string;
  is_lead: boolean;
};

type TeacherUser = {
  id: string;
  name: string;
  email: string | null;
};

export const listBatches = async (req: Request, res: Response): Promise<void> => {
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

    const { data: batches, error: batchesErr } = await supabase
      .from('batches')
      .select('id, tution_id, name, code, start_date, end_date, created_at')
      .eq('tution_id', tution_id)
      .order('created_at', { ascending: false });

    if (batchesErr) {
      console.error('listBatches: lookup failed:', batchesErr);
      res.status(500).json({ msg: 'Server error' });
      return;
    }

    const batchRows = (batches ?? []) as BatchRow[];
    const batchIds = batchRows.map((b) => b.id);

    // student counts per batch
    const countsMap: Record<string, number> = {};
    // teacher links keyed by batch_id
    const teacherLinksByBatch = new Map<string, BatchTeacherLink[]>();
    const allTeacherIds = new Set<string>();

    if (batchIds.length > 0) {
      const [{ data: batchStudents, error: bsErr }, { data: batchTeachers, error: btErr }] = await Promise.all([
        supabase.from('batch_students').select('batch_id').in('batch_id', batchIds),
        supabase
          .from('batch_teachers')
          .select('batch_id, teacher_user_id, is_lead')
          .in('batch_id', batchIds)
      ]);

      if (bsErr) {
        console.error('listBatches: batch_students lookup failed:', bsErr);
        res.status(500).json({ msg: 'Server error' });
        return;
      }
      if (btErr) {
        console.error('listBatches: batch_teachers lookup failed:', btErr);
        res.status(500).json({ msg: 'Server error' });
        return;
      }

      for (const row of batchStudents ?? []) {
        const id = (row as { batch_id: string }).batch_id;
        countsMap[id] = (countsMap[id] ?? 0) + 1;
      }

      for (const row of (batchTeachers ?? []) as BatchTeacherLink[]) {
        const list = teacherLinksByBatch.get(row.batch_id) ?? [];
        list.push(row);
        teacherLinksByBatch.set(row.batch_id, list);
        allTeacherIds.add(row.teacher_user_id);
      }
    }

    // teacher info map
    const teachersMap: Record<string, TeacherUser> = {};
    if (allTeacherIds.size > 0) {
      const { data: teachers, error: teacherErr } = await supabase
        .from('users')
        .select('id, name, email')
        .in('id', Array.from(allTeacherIds));

      if (teacherErr) {
        console.error('listBatches: teacher lookup failed:', teacherErr);
        res.status(500).json({ msg: 'Server error' });
        return;
      }

      for (const t of (teachers ?? []) as TeacherUser[]) {
        teachersMap[t.id] = { id: t.id, name: t.name ?? null, email: t.email ?? null };
      }
    }

    // institution name (tution)
    let institutionName: string | null = null;
    const { data: tutionRow, error: tutionErr } = await supabase
      .from('tutions')
      .select('id, name')
      .eq('id', tution_id)
      .maybeSingle();

    if (tutionErr) {
      console.error('listBatches: tution lookup failed:', tutionErr);
      res.status(500).json({ msg: 'Server error' });
      return;
    }
    if (tutionRow) institutionName = (tutionRow as { name: string | null }).name ?? null;

    const out = batchRows.map((b) => {
      const links = teacherLinksByBatch.get(b.id) ?? [];
      const teachers = links
        .map((l) => {
          const u = teachersMap[l.teacher_user_id];
          return u ? { ...u, is_lead: l.is_lead } : null;
        })
        .filter((t): t is TeacherUser & { is_lead: boolean } => t !== null)
        .sort((a, b) => (b.is_lead ? 1 : 0) - (a.is_lead ? 1 : 0) || (a.name ?? '').localeCompare(b.name ?? ''));

      return {
        id: b.id,
        name: b.name,
        code: b.code,
        start_date: b.start_date,
        end_date: b.end_date,
        student_count: countsMap[b.id] ?? 0,
        teachers,
        institution_name: institutionName
      };
    });

    res.status(200).json({ batches: out });
  } catch (err) {
    console.error('listBatches error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};
