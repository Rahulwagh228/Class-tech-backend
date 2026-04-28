import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../src/app.js';

describe('app', () => {
  it('returns health status', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
  });

  it('creates and fetches a task', async () => {
    const createResponse = await request(app)
      .post('/api/v1/tasks')
      .send({ title: 'Ship backend', status: 'todo' });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.data.title).toBe('Ship backend');

    const taskId = createResponse.body.data.id as string;
    const getResponse = await request(app).get(`/api/v1/tasks/${taskId}`);

    expect(getResponse.status).toBe(200);
    expect(getResponse.body.data.id).toBe(taskId);
  });
});