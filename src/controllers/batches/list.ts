import type { Request, Response } from 'express';
import supabase from '../../config/connectSupabase.js';

type BatchRow = {
  id: string;
  tution_id: string;
  name: string;
  code: string;
  teacher_id: string | null;
  start_date: string;
  end_date: string | null;
  created_at: string;
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
      .select('id, tution_id, name, code, teacher_id, start_date, end_date, created_at')
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
    if (batchIds.length > 0) {
      const { data: batchStudents, error: bsErr } = await supabase
        .from('batch_students')
        .select('batch_id')
        .in('batch_id', batchIds);

      if (bsErr) {
        console.error('listBatches: batch_students lookup failed:', bsErr);
        res.status(500).json({ msg: 'Server error' });
        return;
      }

      for (const row of batchStudents ?? []) {
        const id = (row as any).batch_id as string;
        countsMap[id] = (countsMap[id] ?? 0) + 1;
      }
    }

    // teacher info map
    const teacherIds = Array.from(new Set(batchRows.map((b) => b.teacher_id).filter(Boolean) as string[]));
    const teachersMap: Record<string, { id: string; name: string | null; email: string | null }> = {};
    if (teacherIds.length > 0) {
      const { data: teachers, error: teacherErr } = await supabase
        .from('users')
        .select('id, name, email')
        .in('id', teacherIds);

      if (teacherErr) {
        console.error('listBatches: teacher lookup failed:', teacherErr);
        res.status(500).json({ msg: 'Server error' });
        return;
      }

      for (const t of teachers ?? []) {
        teachersMap[(t as any).id] = { id: (t as any).id, name: (t as any).name ?? null, email: (t as any).email ?? null };
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
    if (tutionRow) institutionName = (tutionRow as any).name ?? null;

    const out = batchRows.map((b) => ({
      id: b.id,
      name: b.name,
      code: b.code,
      start_date: b.start_date,
      end_date: b.end_date,
      student_count: countsMap[b.id] ?? 0,
      teacher: b.teacher_id ? teachersMap[b.teacher_id] ?? null : null,
      institution_name: institutionName
    }));

    res.status(200).json({ batches: out });
  } catch (err) {
    console.error('listBatches error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};
