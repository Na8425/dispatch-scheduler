import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { pool } from '../config/db';
import { logger } from '../utils/logger';

async function seed(): Promise<void> {
  const passwordHash = await bcrypt.hash('password123', 10);

  const userRes = await pool.query(
    `INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    ['demo@example.com', passwordHash, 'Demo User']
  );
  const userId = userRes.rows[0].id;

  const orgRes = await pool.query(
    `INSERT INTO organizations (name, slug, owner_id) VALUES ($1, $2, $3)
     ON CONFLICT (slug) DO NOTHING RETURNING id`,
    ['Demo Org', 'demo-org', userId]
  );
  let orgId = orgRes.rows[0]?.id;
  if (!orgId) {
    const existing = await pool.query('SELECT id FROM organizations WHERE slug = $1', ['demo-org']);
    orgId = existing.rows[0].id;
  }

  await pool.query(
    `INSERT INTO organization_members (org_id, user_id, role) VALUES ($1, $2, 'owner')
     ON CONFLICT DO NOTHING`,
    [orgId, userId]
  );

  const apiKey = 'sk_demo_' + randomBytes(16).toString('hex');
  const apiKeyHash = await bcrypt.hash(apiKey, 10);

  const projectRes = await pool.query(
    `INSERT INTO projects (org_id, name, api_key_hash, created_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (org_id, name) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [orgId, 'Demo Project', apiKeyHash, userId]
  );
  const projectId = projectRes.rows[0].id;

  const retryPolicyRes = await pool.query(
    `INSERT INTO retry_policies (project_id, name, strategy, base_delay_ms, multiplier, max_attempts, jitter)
     VALUES ($1, 'default-exponential', 'exponential', 1000, 2.0, 5, true)
     ON CONFLICT (project_id, name) DO UPDATE SET strategy = EXCLUDED.strategy
     RETURNING id`,
    [projectId]
  );
  const retryPolicyId = retryPolicyRes.rows[0].id;

  const queueRes = await pool.query(
    `INSERT INTO queues (project_id, name, priority, max_concurrency, default_retry_policy_id)
     VALUES ($1, 'default', 0, 5, $2)
     ON CONFLICT (project_id, name) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [projectId, retryPolicyId]
  );
  const queueId = queueRes.rows[0].id;

  await pool.query(
    `INSERT INTO jobs (queue_id, project_id, job_type, task_name, payload, status, retry_policy_id)
     VALUES
       ($1, $2, 'immediate', 'noop', '{"greeting":"hello"}', 'queued', $3),
       ($1, $2, 'immediate', 'send_email', '{"to":"user@example.com","subject":"Welcome"}', 'queued', $3),
       ($1, $2, 'immediate', 'flaky_task', '{"failureRate":0.7}', 'queued', $3)`,
    [queueId, projectId, retryPolicyId]
  );

  logger.info({ userId, orgId, projectId, queueId, apiKey }, 'Seed complete');
  // eslint-disable-next-line no-console
  console.log('\n--- Demo credentials ---');
  console.log('Email:    demo@example.com');
  console.log('Password: password123');
  console.log('Project API key:', apiKey);
  console.log('Project ID:', projectId);
  console.log('Queue ID:', queueId);
  console.log('------------------------\n');

  await pool.end();
}

seed().catch((err) => {
  logger.error({ err }, 'Seed failed');
  process.exit(1);
});
