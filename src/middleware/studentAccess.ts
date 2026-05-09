import type { NextFunction, Request, Response } from 'express';
import supabase from '../config/connectSupabase.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// =============================================================================
// requireStudentAccess
//
// Loads the student identified by req.params.studentId and verifies they exist
// in the caller's tution. Then enforces:
//   - admin            : pass
//   - student (self)   : pass when studentId === req.user.id
//   - parent (linked)  : pass when a row exists in parent_students
//                        (parent_user_id = caller, student_user_id = studentId)
//   - else             : 403
//
// Returns 404 (not 403) on cross-tenant lookups so we don't leak existence.
// =============================================================================
export async function requireStudentAccess(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
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
  if (!studentId || !UUID_RE.test(studentId)) {
    res.status(400).json({ msg: 'studentId must be a valid UUID' });
    return;
  }

  const { data: studentUser, error: studentErr } = await supabase
    .from('users')
    .select('id, role')
    .eq('id', studentId)
    .eq('tution_id', tution_id)
    .eq('role', 'student')
    .maybeSingle<{ id: string; role: string }>();

  if (studentErr) {
    console.error('requireStudentAccess: student lookup failed:', studentErr);
    res.status(500).json({ msg: 'Server error' });
    return;
  }
  if (!studentUser) {
    res.status(404).json({ msg: 'Student not found' });
    return;
  }

  const role = req.user.role;
  if (role === 'admin') {
    next();
    return;
  }
  if (role === 'student' && req.user.id === studentId) {
    next();
    return;
  }
  if (role === 'parent') {
    const { data: link, error: linkErr } = await supabase
      .from('parent_students')
      .select('id')
      .eq('parent_user_id', req.user.id)
      .eq('student_user_id', studentId)
      .eq('tution_id', tution_id)
      .maybeSingle<{ id: string }>();

    if (linkErr) {
      console.error('requireStudentAccess: parent link lookup failed:', linkErr);
      res.status(500).json({ msg: 'Server error' });
      return;
    }
    if (link) {
      next();
      return;
    }
  }

  res.status(403).json({ msg: 'Not authorized to view this student' });
}

// Injects the caller's own id as :studentId so /me/... routes can reuse the
// same controllers that power /students/:studentId/.... Requires student role.
export function fillSelfStudentId(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ msg: 'Authentication required' });
    return;
  }
  if (req.user.role !== 'student') {
    res.status(403).json({ msg: 'Only students can use /me routes' });
    return;
  }
  req.params.studentId = req.user.id;
  next();
}
