import { env } from './config/env';
import { logger } from './utils/logger';
import { acquireLock, releaseLock } from './config/redis';
import { promoteScheduledJobs, reapExpiredLeases } from './services/scheduler.service';
import { tickDueScheduledJobs } from './services/scheduledJob.service';
import { markStaleWorkersOffline } from './services/worker.service';

const LOCK_KEY = 'scheduler-leader';
let running = true;

/**
 * The scheduler process handles everything that must happen exactly-once
 * per tick, cluster-wide: promoting due `scheduled` jobs to `queued`,
 * firing due recurring cron definitions, reaping jobs whose worker lease
 * expired, and marking silent workers offline.
 *
 * You can run multiple replicas of this process for availability. Only the
 * replica holding the Redis lock does work on a given tick; if it dies, the
 * lock expires (TTL) and another replica takes over within one lock TTL
 * window. Losing leadership never causes double-execution of user jobs —
 * that guarantee lives at the DB layer (SKIP LOCKED) — it only means
 * promotion/cron-ticking pauses briefly, which is self-healing.
 */
async function tick(): Promise<void> {
  const token = await acquireLock(LOCK_KEY, env.scheduler.lockTtlMs);
  if (!token) {
    // Another replica is currently leader — nothing to do this tick.
    return;
  }

  try {
    const promoted = await promoteScheduledJobs();
    const spawned = await tickDueScheduledJobs();
    const reaped = await reapExpiredLeases();
    const staleWorkers = await markStaleWorkersOffline(env.worker.leaseMs * 3);

    if (promoted || spawned || reaped || staleWorkers) {
      logger.info({ promoted, spawned, reaped, staleWorkers }, 'Scheduler tick');
    }
  } catch (err) {
    logger.error({ err }, 'Scheduler tick failed');
  } finally {
    await releaseLock(LOCK_KEY, token);
  }
}

async function loop(): Promise<void> {
  while (running) {
    await tick();
    await new Promise((resolve) => setTimeout(resolve, env.scheduler.tickMs));
  }
}

process.on('SIGTERM', () => {
  logger.info('Scheduler shutting down');
  running = false;
});
process.on('SIGINT', () => {
  running = false;
});

if (require.main === module) {
  logger.info({ tickMs: env.scheduler.tickMs }, 'Scheduler process starting');
  loop();
}
