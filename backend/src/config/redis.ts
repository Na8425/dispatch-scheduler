import Redis from 'ioredis';
import { env } from './env';
import { randomUUID } from 'crypto';

export const redis = new Redis(env.redisUrl, {
  maxRetriesPerRequest: 3,
  lazyConnect: false,
});

/**
 * Distributed lock (Redlock-lite, single-instance Redis).
 * Used by the scheduler process for leader election: if you run multiple
 * scheduler replicas for HA, only the one holding the lock promotes
 * scheduled jobs / ticks cron definitions, preventing duplicate spawns.
 *
 * This is a simplified single-node lock, not the full multi-node Redlock
 * algorithm — sufficient here because losing the lock only pauses
 * promotion briefly (self-healing), it never causes double execution of
 * user jobs (that's guaranteed at the DB layer via SKIP LOCKED regardless).
 */
export async function acquireLock(key: string, ttlMs: number): Promise<string | null> {
  const token = randomUUID();
  const result = await redis.set(`lock:${key}`, token, 'PX', ttlMs, 'NX');
  return result === 'OK' ? token : null;
}

const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

export async function releaseLock(key: string, token: string): Promise<void> {
  await redis.eval(RELEASE_SCRIPT, 1, `lock:${key}`, token);
}

const EXTEND_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
else
  return 0
end
`;

export async function extendLock(key: string, token: string, ttlMs: number): Promise<boolean> {
  const result = await redis.eval(EXTEND_SCRIPT, 1, `lock:${key}`, token, ttlMs.toString());
  return result === 1;
}

/**
 * Fixed-window token bucket rate limiter, used both for the public API
 * (per API key) and per-queue job dispatch (rate_limit_per_sec on queues).
 * Returns true if the call is allowed under the limit.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number }> {
  const redisKey = `ratelimit:${key}:${Math.floor(Date.now() / (windowSeconds * 1000))}`;
  const count = await redis.incr(redisKey);
  if (count === 1) {
    await redis.expire(redisKey, windowSeconds);
  }
  return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
}
