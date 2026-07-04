import parser from 'cron-parser';
import { query, withTransaction } from '../config/db';
import { NotFoundError, ValidationError } from '../utils/errors';
import { publishEvent } from '../ws/events';

export interface CreateScheduledJobInput {
  name: string;
  taskName: string;
  payloadTemplate?: Record<string, unknown>;
  cronExpression: string;
  timezone?: string;
  priority?: number;
  retryPolicyId?: string | null;
}

function computeNextRun(cronExpression: string, timezone: string): Date {
  try {
    const interval = parser.parseExpression(cronExpression, { tz: timezone });
    return interval.next().toDate();
  } catch (err) {
    throw new ValidationError({ cronExpression: 'Invalid cron expression' });
  }
}

export async function createScheduledJob(queueId: string, input: CreateScheduledJobInput) {
  const timezone = input.timezone ?? 'UTC';
  const nextRunAt = computeNextRun(input.cronExpression, timezone);

  const result = await query(
    `INSERT INTO scheduled_jobs (queue_id, name, task_name, payload_template, cron_expression, timezone, priority, retry_policy_id, next_run_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      queueId,
      input.name,
      input.taskName,
      JSON.stringify(input.payloadTemplate ?? {}),
      input.cronExpression,
      timezone,
      input.priority ?? 0,
      input.retryPolicyId ?? null,
      nextRunAt.toISOString(),
    ]
  );
  return result.rows[0];
}

export async function listScheduledJobs(queueId: string) {
  const result = await query(`SELECT * FROM scheduled_jobs WHERE queue_id = $1 ORDER BY created_at DESC`, [
    queueId,
  ]);
  return result.rows;
}

export async function setScheduledJobActive(scheduledJobId: string, isActive: boolean) {
  const result = await query(`UPDATE scheduled_jobs SET is_active = $2 WHERE id = $1 RETURNING *`, [
    scheduledJobId,
    isActive,
  ]);
  if (result.rows.length === 0) throw new NotFoundError('Scheduled job');
  return result.rows[0];
}

/**
 * Finds all due cron definitions and spawns one `jobs` row per firing,
 * advancing next_run_at. Called on every scheduler tick, guarded by the
 * distributed lock in scheduler.ts so only one scheduler replica runs this
 * at a time (preventing duplicate spawns if you scale the scheduler out).
 */
export async function tickDueScheduledJobs(): Promise<number> {
  const dueRes = await query(
    `SELECT sj.*, q.project_id FROM scheduled_jobs sj
     JOIN queues q ON q.id = sj.queue_id
     WHERE sj.is_active = true AND sj.next_run_at <= now()
     FOR UPDATE OF sj SKIP LOCKED`
  );

  let spawned = 0;
  for (const def of dueRes.rows) {
    await withTransaction(async (client) => {
      const jobRes = await client.query(
        `INSERT INTO jobs (queue_id, project_id, job_type, task_name, payload, priority, status, run_at, retry_policy_id, scheduled_job_id)
         VALUES ($1, $2, 'recurring', $3, $4, $5, 'queued', now(), $6, $7)
         RETURNING id`,
        [def.queue_id, def.project_id, def.task_name, JSON.stringify(def.payload_template), def.priority, def.retry_policy_id, def.id]
      );

      const nextRunAt = computeNextRun(def.cron_expression, def.timezone);
      await client.query(
        `UPDATE scheduled_jobs SET last_run_at = now(), next_run_at = $2 WHERE id = $1`,
        [def.id, nextRunAt.toISOString()]
      );

      publishEvent(def.project_id, 'job.created', {
        jobId: jobRes.rows[0].id,
        queueId: def.queue_id,
        source: 'recurring',
        scheduledJobId: def.id,
      });
    });
    spawned++;
  }
  return spawned;
}
