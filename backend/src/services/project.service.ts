import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { query } from '../config/db';
import { NotFoundError } from '../utils/errors';

function generateApiKey(): string {
  return 'sk_' + randomBytes(24).toString('hex');
}

export async function createProject(orgId: string, name: string, userId: string) {
  const apiKey = generateApiKey();
  const apiKeyHash = await bcrypt.hash(apiKey, 10);

  const result = await query(
    `INSERT INTO projects (org_id, name, api_key_hash, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING id, org_id, name, created_at`,
    [orgId, name, apiKeyHash, userId]
  );

  // The plaintext API key is only ever returned once, at creation time.
  return { project: result.rows[0], apiKey };
}

export async function listProjects(orgId: string) {
  const result = await query(
    `SELECT id, org_id, name, created_at, updated_at FROM projects WHERE org_id = $1 ORDER BY created_at DESC`,
    [orgId]
  );
  return result.rows;
}

export async function getProject(projectId: string) {
  const result = await query(
    `SELECT id, org_id, name, created_at, updated_at FROM projects WHERE id = $1`,
    [projectId]
  );
  if (result.rows.length === 0) throw new NotFoundError('Project');
  return result.rows[0];
}
