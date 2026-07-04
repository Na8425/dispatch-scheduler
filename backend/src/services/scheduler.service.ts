import { query } from '../config/db';
import { failJob } from './job.service';
import { publishEvent } from '../ws/events';
import { logger } from '../utils/logger';

/**
 * Promotes jobs whose scheduled run_at has arrived from 'scheduled' to
 * 'queued', making them visible to the worker claim query. Kept as a
 * separate step (rather than having claimJobs match on status='scheduled'
 * directly) so the dashboard can show "Scheduled" vs "Queued" as distinct,
 * meaningful lifecycle states per the spec.
 */
export async function promoteScheduledJobs(): Promise<number> {
  const result = await query(
    `UPDATE jobs SET status = 'queued'
     WHERE status = 'scheduled' AND run_at <= now()
     RETURNING id, project_id, queue_id`
  );
  for (const row of result.rows) {
    publishEvent(row.project_id, 'job.promoted', { jobId: row.id, queueId: row.queue_id });
  }
  return result.rowCount ?? 0;
}

/**
 * Reclaims jobs whose worker lease has expired without a heartbeat —
 * the signal that a worker crashed, was killed, or lost network
 * connectivity mid-execution. Each expired job is routed through the same
 * failJob() retry/DLQ logic used for a normal execution failure, so a
 * crash consumes one retry attempt just like any other failure would.
 */
export async function reapExpiredLeases(): Promise<number> {
  const expiredRes = await query(
    `SELECT j.id, je.id AS execution_id
     FROM jobs j
     LEFT JOIN job_executions je ON je.job_id = j.id AND je.attempt_number = j.attempt_count + 1
     WHERE j.status IN ('claimed', 'running') AND j.locked_until < now()`
  );

  let reaped = 0;
  for (const row of expiredRes.rows) {
    try {
      // If the job never made it to startExecution (still 'claimed'), there
      // is no open execution row to close out — synthesize one so the
      // failure is still recorded in the audit trail.
      const executionId = row.execution_id ?? (await ensureExecutionRow(row.id));
      await failJob(row.id, executionId, 'Worker lease expired — no heartbeat received (worker likely crashed)');
      reaped++;
    } catch (err) {
      logger.error({ err, jobId: row.id }, 'Failed to reap expired lease');
    }
  }
  return reaped;
}

async function ensureExecutionRow(jobId: string): Promise<string> {
  const jobRes = await query(`SELECT attempt_count, claimed_by FROM jobs WHERE id = $1`, [jobId]);
  const job = jobRes.rows[0];
  const execRes = await query(
    `INSERT INTO job_executions (job_id, worker_id, attempt_number, status, started_at)
     VALUES ($1, $2, $3, 'running', now())
     ON CONFLICT (job_id, attempt_number) DO UPDATE SET worker_id = EXCLUDED.worker_id
     RETURNING id`,
    [jobId, job.claimed_by, job.attempt_count + 1]
  );
  return execRes.rows[0].id;
}
