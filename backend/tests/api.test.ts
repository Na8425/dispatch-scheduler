import request from 'supertest';
import { app } from '../src/index';
import { pool } from '../src/config/db';

let token: string;
let orgId: string;
let projectId: string;
let queueId: string;
const testEmail = `api-test-${Date.now()}@test.local`;

afterAll(async () => {
  await pool.end();
});

describe('Auth', () => {
  it('registers a new user and organization', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      email: testEmail,
      password: 'password123',
      name: 'API Test User',
      organizationName: 'API Test Org',
    });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
    expect(res.body.organization.id).toBeDefined();
    token = res.body.token;
    orgId = res.body.organization.id;
  });

  it('rejects registration with an invalid email (validation)', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      email: 'not-an-email',
      password: 'password123',
      name: 'X',
      organizationName: 'Y',
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a duplicate registration with 409', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      email: testEmail,
      password: 'password123',
      name: 'API Test User',
      organizationName: 'API Test Org 2',
    });
    expect(res.status).toBe(409);
  });

  it('logs in with correct credentials', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({
      email: testEmail,
      password: 'password123',
    });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  it('rejects login with wrong password', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({
      email: testEmail,
      password: 'wrongpassword',
    });
    expect(res.status).toBe(401);
  });

  it('rejects unauthenticated access to protected routes', async () => {
    const res = await request(app).get('/api/v1/auth/me/organizations');
    expect(res.status).toBe(401);
  });
});

describe('Projects and Queues', () => {
  it('creates a project (returns API key once)', async () => {
    const res = await request(app)
      .post(`/api/v1/organizations/${orgId}/projects`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test Project' });
    expect(res.status).toBe(201);
    expect(res.body.apiKey).toMatch(/^sk_/);
    projectId = res.body.project.id;
  });

  it('creates a queue with custom concurrency and priority', async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/queues`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'test-queue', maxConcurrency: 3, priority: 5 });
    expect(res.status).toBe(201);
    expect(res.body.data.max_concurrency).toBe(3);
    expect(res.body.data.priority).toBe(5);
    queueId = res.body.data.id;
  });

  it('rejects invalid queue config (maxConcurrency below minimum)', async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/queues`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'bad-queue', maxConcurrency: 0 });
    expect(res.status).toBe(422);
  });

  it('pauses and resumes a queue', async () => {
    const pauseRes = await request(app)
      .post(`/api/v1/queues/${queueId}/pause`)
      .set('Authorization', `Bearer ${token}`);
    expect(pauseRes.body.data.is_paused).toBe(true);

    const resumeRes = await request(app)
      .post(`/api/v1/queues/${queueId}/resume`)
      .set('Authorization', `Bearer ${token}`);
    expect(resumeRes.body.data.is_paused).toBe(false);
  });
});

describe('Jobs', () => {
  it('creates an immediate job with default status=queued', async () => {
    const res = await request(app)
      .post(`/api/v1/queues/${queueId}/jobs`)
      .set('Authorization', `Bearer ${token}`)
      .send({ taskName: 'noop', payload: { a: 1 } });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('queued');
    expect(res.body.data.job_type).toBe('immediate');
  });

  it('creates a delayed job with status=scheduled and a future run_at', async () => {
    const res = await request(app)
      .post(`/api/v1/queues/${queueId}/jobs`)
      .set('Authorization', `Bearer ${token}`)
      .send({ taskName: 'noop', delayMs: 60000 });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('scheduled');
    expect(new Date(res.body.data.run_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects a job with a missing required field', async () => {
    const res = await request(app)
      .post(`/api/v1/queues/${queueId}/jobs`)
      .set('Authorization', `Bearer ${token}`)
      .send({ payload: { a: 1 } }); // missing taskName
    expect(res.status).toBe(422);
  });

  it('creates a batch of jobs sharing one batch_id', async () => {
    const res = await request(app)
      .post(`/api/v1/queues/${queueId}/jobs/batch`)
      .set('Authorization', `Bearer ${token}`)
      .send({ jobs: [{ taskName: 'noop' }, { taskName: 'noop' }, { taskName: 'noop' }] });
    expect(res.status).toBe(201);
    expect(res.body.data.jobs.length).toBe(3);
    const batchId = res.body.data.batchId;

    const statusRes = await request(app)
      .get(`/api/v1/batches/${batchId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.data.total).toBe(3);
  });

  it('paginates job listings', async () => {
    const res = await request(app)
      .get(`/api/v1/queues/${queueId}/jobs?page=1&pageSize=2`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(2);
    expect(res.body.meta.pageSize).toBe(2);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(5);
  });

  it('filters job listings by status', async () => {
    const res = await request(app)
      .get(`/api/v1/queues/${queueId}/jobs?status=scheduled`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    for (const job of res.body.data) {
      expect(job.status).toBe('scheduled');
    }
  });

  it('honors idempotency keys — repeat creation returns the same job', async () => {
    const first = await request(app)
      .post(`/api/v1/queues/${queueId}/jobs`)
      .set('Authorization', `Bearer ${token}`)
      .send({ taskName: 'noop', idempotencyKey: 'idem-test-1' });
    const second = await request(app)
      .post(`/api/v1/queues/${queueId}/jobs`)
      .set('Authorization', `Bearer ${token}`)
      .send({ taskName: 'noop', idempotencyKey: 'idem-test-1' });
    expect(first.body.data.id).toBe(second.body.data.id);
  });
});

describe('RBAC', () => {
  it('a second user with no membership cannot access the project queues', async () => {
    const otherEmail = `api-test-other-${Date.now()}@test.local`;
    const registerRes = await request(app).post('/api/v1/auth/register').send({
      email: otherEmail,
      password: 'password123',
      name: 'Other User',
      organizationName: 'Other Org',
    });
    const otherToken = registerRes.body.token;

    const res = await request(app)
      .get(`/api/v1/projects/${projectId}/queues`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(res.status).toBe(403);
  });
});
