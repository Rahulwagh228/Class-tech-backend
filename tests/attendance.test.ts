import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../src/app.js';

// These tests exercise the auth + validation guards on the attendance routes.
// They intentionally do NOT touch Supabase - any code path that reaches a
// query would require a live DB or a mock. Database-backed assertions are
// covered by the manual smoke tests in the plan and a future integration
// suite.

describe('attendance routes - auth guard', () => {
  it('rejects POST mark without auth', async () => {
    const res = await request(app)
      .post('/api/v1/attendance/batches/00000000-0000-0000-0000-000000000000/mark')
      .send({ date: '2026-05-09', records: [] });
    expect(res.status).toBe(401);
  });

  it('rejects GET list without auth', async () => {
    const res = await request(app).get(
      '/api/v1/attendance/batches/00000000-0000-0000-0000-000000000000'
    );
    expect(res.status).toBe(401);
  });

  it('rejects GET summary without auth', async () => {
    const res = await request(app).get(
      '/api/v1/attendance/batches/00000000-0000-0000-0000-000000000000/summary'
    );
    expect(res.status).toBe(401);
  });

  it('rejects PATCH without auth', async () => {
    const res = await request(app)
      .patch('/api/v1/attendance/00000000-0000-0000-0000-000000000000')
      .send({ status: 'present' });
    expect(res.status).toBe(401);
  });

  it('rejects DELETE without auth', async () => {
    const res = await request(app).delete(
      '/api/v1/attendance/00000000-0000-0000-0000-000000000000'
    );
    expect(res.status).toBe(401);
  });

  it('rejects GET student history without auth', async () => {
    const res = await request(app).get(
      '/api/v1/attendance/students/00000000-0000-0000-0000-000000000000'
    );
    expect(res.status).toBe(401);
  });

  it('rejects malformed bearer token', async () => {
    const res = await request(app)
      .get('/api/v1/attendance/batches/00000000-0000-0000-0000-000000000000')
      .set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });
});
