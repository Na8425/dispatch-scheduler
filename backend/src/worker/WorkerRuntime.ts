import os from 'os';
import { logger } from '../utils/logger';
import { env } from '../config/env';
import { query } from '../config/db';
import { claimJobs, startExecution, completeJob, failJob, extendLease, appendJobLog } from '../services/job.service';
import { registerWorker, recordHeartbeat, setWorkerStatus } from '../services/worker.service';
import { resolveHandler } from './handlers';
import { Job } from '../types/domain';

export interface WorkerRuntimeOptions {
  projectId: string;
  concurrency?: number;
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  leaseMs?: number;
  shutdownGraceMs?: number;
}

/**
 * A single worker process. Run many of these (different machines/containers,
 * same or different `projectId`) to scale horizontally — safety under
 * concurrent claiming from multiple workers is guaranteed by the DB-level
 * `FOR UPDATE SKIP LOCKED` claim query, not by anything in this class.
 */
export class WorkerRuntime {
  private readonly opts: Required<WorkerRuntimeOptions>;
  private workerId!: string;
  private polling = false;
  private shuttingDown = false;
  private activeExecutions = new Map<string, Promise<void>>();
  private pollTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;

  constructor(options: WorkerRuntimeOptions) {
    this.opts = {
      projectId: options.projectId,
      concurrency: options.concurrency ?? env.worker.concurrency,
      pollIntervalMs: options.pollIntervalMs ?? env.worker.pollIntervalMs,
      heartbeatIntervalMs: options.heartbeatIntervalMs ?? env.worker.heartbeatIntervalMs,
      leaseMs: options.leaseMs ?? env.worker.leaseMs,
      shutdownGraceMs: options.shutdownGraceMs ?? env.worker.shutdownGraceMs,
    };
  }

  async start(): Promise<void> {
    const worker = await registerWorker(
      this.opts.projectId,
      os.hostname(),
      process.pid,
      this.opts.concurrency,
      '1.0.0'
    );
    this.workerId = worker.id;
    logger.info({ workerId: this.workerId, concurrency: this.opts.concurrency }, 'Worker registered, starting poll loop');

    this.polling = true;
    this.scheduleNextPoll(0);

    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), this.opts.heartbeatIntervalMs);

    process.on('SIGTERM', () => this.shutdown());
    process.on('SIGINT', () => this.shutdown());
  }

  private scheduleNextPoll(delayMs: number): void {
    if (!this.polling) return;
    this.pollTimer = setTimeout(() => this.pollOnce(), delayMs);
  }

  private async pollOnce(): Promise<void> {
    if (!this.polling) return;
    try {
      const freeSlots = this.opts.concurrency - this.activeExecutions.size;
      if (freeSlots > 0) {
        const queues = await this.getActiveQueues();
        for (const q of queues) {
          if (this.activeExecutions.size >= this.opts.concurrency) break;
          const remaining = this.opts.concurrency - this.activeExecutions.size;
          const claimed = await claimJobs(q.id, this.workerId, remaining, this.opts.leaseMs);
          for (const job of claimed) {
            this.executeJob(job); // fire and forget — tracked via activeExecutions
          }
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error during poll cycle');
    } finally {
      this.scheduleNextPoll(this.opts.pollIntervalMs);
    }
  }

  private async getActiveQueues(): Promise<{ id: string }[]> {
    const result = await query(
      `SELECT id FROM queues WHERE project_id = $1 AND is_paused = false ORDER BY priority DESC`,
      [this.opts.projectId]
    );
    return result.rows;
  }

  private executeJob(job: Job): void {
    const execution = this.runJob(job).finally(() => {
      this.activeExecutions.delete(job.id);
    });
    this.activeExecutions.set(job.id, execution);
  }

  private async runJob(job: Job): Promise<void> {
    let executionId: string;
    try {
      const started = await startExecution(job.id, this.workerId);
      executionId = started.executionId;
    } catch (err) {
      // Lease was reclaimed (e.g. by the reaper) before we could start — bail quietly.
      logger.warn({ jobId: job.id, err }, 'Could not start execution (lease likely reclaimed)');
      return;
    }

    // Keep the lease alive for long-running jobs by renewing it at half the
    // lease duration. If this worker dies, renewals stop and the reaper
    // will reclaim the job once locked_until passes.
    const leaseRenewal = setInterval(() => {
      extendLease(job.id, this.workerId, this.opts.leaseMs).catch((err) =>
        logger.error({ err, jobId: job.id }, 'Failed to extend lease')
      );
    }, Math.floor(this.opts.leaseMs / 2));

    try {
      await appendJobLog(job.id, executionId, 'info', `Execution started on worker ${this.workerId}`);
      const handler = resolveHandler(job.task_name);
      const result = await handler(job.payload);
      await completeJob(job.id, executionId, result);
      await appendJobLog(job.id, executionId, 'info', 'Execution completed successfully');
    } catch (err: any) {
      const message = err?.message ?? String(err);
      await appendJobLog(job.id, executionId, 'error', `Execution failed: ${message}`);
      const outcome = await failJob(job.id, executionId, message, err?.stack);
      logger.warn(
        { jobId: job.id, retried: outcome.retried, nextRunAt: outcome.nextRunAt },
        'Job execution failed'
      );
    } finally {
      clearInterval(leaseRenewal);
    }
  }

  private async sendHeartbeat(): Promise<void> {
    try {
      await recordHeartbeat(this.workerId, this.activeExecutions.size, os.loadavg()[0], process.memoryUsage().rss / (1024 * 1024));
    } catch (err) {
      logger.error({ err }, 'Failed to send heartbeat');
    }
  }

  /**
   * Graceful shutdown: stop accepting new work immediately, then wait for
   * in-flight jobs to finish naturally (up to shutdownGraceMs). Jobs that
   * don't finish in time are left for the lease-expiry reaper to reclaim
   * rather than being force-cancelled mid-execution, since Node cannot
   * safely abort an arbitrary in-flight async handler.
   */
  async shutdown(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    logger.info({ workerId: this.workerId, active: this.activeExecutions.size }, 'Shutdown signal received, draining');

    this.polling = false;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    await setWorkerStatus(this.workerId, 'draining');

    const pending = Array.from(this.activeExecutions.values());
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, this.opts.shutdownGraceMs));
    await Promise.race([Promise.all(pending), timeout]);

    if (this.activeExecutions.size > 0) {
      logger.warn(
        { remaining: this.activeExecutions.size },
        'Shutdown grace period elapsed with jobs still in flight; leaving them for lease-expiry reclaim'
      );
    }

    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    await setWorkerStatus(this.workerId, 'offline');
    logger.info({ workerId: this.workerId }, 'Worker stopped');
    process.exit(0);
  }
}
