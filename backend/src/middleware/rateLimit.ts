import { Request, Response, NextFunction } from 'express';
import { checkRateLimit } from '../config/redis';
import { RateLimitError } from '../utils/errors';

/**
 * Per-identity rate limiter. Identity is the authenticated user id, the
 * project id (API key auth), or the caller's IP as a last resort — in that
 * priority order, so authenticated callers get a stable, generous quota
 * and anonymous traffic gets a stricter one.
 */
export function rateLimit(limit: number, windowSeconds: number) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const identity = req.user?.id || req.project?.id || req.ip || 'anonymous';
      const { allowed, remaining } = await checkRateLimit(`api:${identity}`, limit, windowSeconds);
      res.setHeader('X-RateLimit-Limit', limit);
      res.setHeader('X-RateLimit-Remaining', remaining);
      if (!allowed) {
        throw new RateLimitError();
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
