import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query, withTransaction } from '../config/db';
import { env } from '../config/env';
import { ConflictError, UnauthorizedError } from '../utils/errors';

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') +
    '-' +
    Math.random().toString(36).slice(2, 7)
  );
}

export async function registerUser(email: string, password: string, name: string, orgName: string) {
  const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length > 0) {
    throw new ConflictError('An account with this email already exists');
  }

  const passwordHash = await bcrypt.hash(password, 10);

  return withTransaction(async (client) => {
    const userRes = await client.query(
      `INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3)
       RETURNING id, email, name, created_at`,
      [email, passwordHash, name]
    );
    const user = userRes.rows[0];

    const orgRes = await client.query(
      `INSERT INTO organizations (name, slug, owner_id) VALUES ($1, $2, $3)
       RETURNING id, name, slug`,
      [orgName, slugify(orgName), user.id]
    );
    const org = orgRes.rows[0];

    await client.query(
      `INSERT INTO organization_members (org_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [org.id, user.id]
    );

    const token = signToken(user.id, user.email);
    return { user, organization: org, token };
  });
}

export async function loginUser(email: string, password: string) {
  const result = await query<{ id: string; email: string; name: string; password_hash: string }>(
    'SELECT id, email, name, password_hash FROM users WHERE email = $1',
    [email]
  );
  const user = result.rows[0];
  if (!user) throw new UnauthorizedError('Invalid email or password');

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) throw new UnauthorizedError('Invalid email or password');

  const token = signToken(user.id, user.email);
  return {
    user: { id: user.id, email: user.email, name: user.name },
    token,
  };
}

function signToken(userId: string, email: string): string {
  return jwt.sign({ sub: userId, email }, env.jwtSecret, { expiresIn: env.jwtExpiresIn } as any);
}

export async function getUserOrganizations(userId: string) {
  const result = await query(
    `SELECT o.id, o.name, o.slug, om.role
     FROM organizations o
     JOIN organization_members om ON om.org_id = o.id
     WHERE om.user_id = $1
     ORDER BY o.created_at ASC`,
    [userId]
  );
  return result.rows;
}
