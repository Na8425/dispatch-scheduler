import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { env } from '../config/env';
import { query } from '../config/db';
import { UnauthorizedError, ForbiddenError } from '../utils/errors';
import { JwtPayload, OrgRole } from '../types/domain';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: string; email: string };
      project?: { id: string; org_id: string };
    }
  }
}

/** Verifies a Bearer JWT and attaches req.user. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing bearer token');
  }
  const token = header.slice('Bearer '.length);
  try {
    const payload = jwt.verify(token, env.jwtSecret) as JwtPayload;
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch {
    throw new UnauthorizedError('Invalid or expired token');
  }
}

/**
 * Verifies a project-scoped API key (used by worker processes and
 * server-to-server job submission) instead of a user JWT.
 * Accepts header: X-Api-Key: <key>
 */
export async function requireApiKey(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const key = req.headers['x-api-key'];
    if (!key || typeof key !== 'string') {
      throw new UnauthorizedError('Missing API key');
    }
    // API keys are stored hashed; we look up by hash comparison across the
    // (typically small) set of project keys. For very large deployments this
    // would be swapped for a prefix-indexed lookup.
    const result = await query<{ id: string; org_id: string; api_key_hash: string }>(
      'SELECT id, org_id, api_key_hash FROM projects'
    );
    const match = result.rows.find((p) => bcrypt.compareSync(key, p.api_key_hash));
    if (!match) {
      throw new UnauthorizedError('Invalid API key');
    }
    req.project = { id: match.id, org_id: match.org_id };
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * RBAC guard: ensures the authenticated user has at least `minRole` within
 * the organization that owns :projectId (or :orgId) in the route params.
 * Role hierarchy: owner > admin > member > viewer.
 *
 * Note: this returns an async function used directly as Express middleware.
 * Express 4 does NOT catch rejected promises thrown from middleware the way
 * it catches synchronous throws, so every code path here goes through a
 * try/catch that forwards to next(err) explicitly — omitting this would
 * turn an authorization failure into a silently hanging request instead of
 * a clean 403.
 */
const ROLE_RANK: Record<OrgRole, number> = { owner: 3, admin: 2, member: 1, viewer: 0 };

export function requireRole(minRole: OrgRole) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) throw new UnauthorizedError();

      const projectId = req.params.projectId;
      const orgId = req.params.orgId;

      let role: OrgRole | null = null;
      if (projectId) {
        const r = await query<{ role: OrgRole }>(
          `SELECT om.role FROM organization_members om
           JOIN projects p ON p.org_id = om.org_id
           WHERE p.id = $1 AND om.user_id = $2`,
          [projectId, req.user.id]
        );
        role = r.rows[0]?.role ?? null;
      } else if (orgId) {
        const r = await query<{ role: OrgRole }>(
          `SELECT role FROM organization_members WHERE org_id = $1 AND user_id = $2`,
          [orgId, req.user.id]
        );
        role = r.rows[0]?.role ?? null;
      }

      if (!role || ROLE_RANK[role] < ROLE_RANK[minRole]) {
        throw new ForbiddenError(`Requires ${minRole} role or higher`);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
