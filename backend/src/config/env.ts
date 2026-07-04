import dotenv from 'dotenv';
dotenv.config();

function required(name: string, fallback?: string): string {
  const val = process.env[name] ?? fallback;
  if (val === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return val;
}

export const env = {
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: required('JWT_SECRET', 'dev_secret_do_not_use_in_prod'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',

  databaseUrl: required('DATABASE_URL'),
  dbPoolMax: parseInt(process.env.DB_POOL_MAX || '20', 10),

  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',

  worker: {
    concurrency: parseInt(process.env.WORKER_CONCURRENCY || '5', 10),
    pollIntervalMs: parseInt(process.env.WORKER_POLL_INTERVAL_MS || '750', 10),
    heartbeatIntervalMs: parseInt(process.env.WORKER_HEARTBEAT_INTERVAL_MS || '5000', 10),
    leaseMs: parseInt(process.env.WORKER_LEASE_MS || '30000', 10),
    shutdownGraceMs: parseInt(process.env.WORKER_SHUTDOWN_GRACE_MS || '15000', 10),
  },

  scheduler: {
    tickMs: parseInt(process.env.SCHEDULER_TICK_MS || '2000', 10),
    lockTtlMs: parseInt(process.env.SCHEDULER_LOCK_TTL_MS || '10000', 10),
  },
};
