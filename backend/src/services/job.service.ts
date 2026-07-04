import { v4 as uuidv4 } from 'uuid';
import { query, withTransaction } from '../config/db';
import { NotFoundError, ConflictError } from '../utils/errors';
import { computeBackoffMs, shouldRetry } from '../utils/backoff';
import { getRetryPolicyConfig } from './retryPolicy.service';
import { Job } from '../types/domain';
import { publishEvent } from '../ws/events';

export interface CreateJobInput {
  taskName: string;
  payload?: Record<string, unknown>;
  priority?: number;
  runAt?: string; // ISO timestamp — for "scheduled" jobs
  delayMs?: number; // for "delayed" jobs
  idempotencyKey?: string;
  retryPolicyId?: string | null;
  dependsOnJobIds?: string[];
}

/**
 * Creates a single job, resolving job_type/status from the input shape:
 *  - dependsOnJobIds present      -> waiting_deps
 *  - runAt in the future           -> scheduled (job_type=scheduled)
 *  - delayMs present               -> scheduled (job_type=delayed), run_at = now()+delayMs
 *  - otherwise                     -> queued (job_type=immediate), run_at = now()
 *
 * Idempotency: if idempotencyKey is provided and a non-terminal job with the
 * same key already exists in the queue, that existing job is returned
 * instead of creating a duplicate (enforced by a partial unique index too,
 * so this is a courtesy fast-path, not the sole guarantee).
 */
export async function createJob(queueId: string, projectId: string, input: CreateJobInput): Promise<Job> {
  if (input.idempotencyKey) {
    const existing = await query<Job>(
      `SELECT * FROM jobs WHERE queue_id = $1 AND idempotency_key = $2
       AND status NOT IN ('completed', 'dead_letter', 'cancelled')`,
      [queueId, input.idempotencyKey]
    );
    if (existing.rows.length > 0) return existing.rows[0];
  }

  let jobType: string = 'immediate';
  let status: string = 'queued';
  let runAt = new Date();

  if (input.dependsOnJobIds && input.dependsOnJobIds.length > 0) {
    status = 'waiting_deps';
    if (input.runAt) runAt = new Date(input.runAt);
  } else if (input.runAt) {
    runAt = new Date(input.runAt);
    jobType = 'scheduled';
    status = runAt.getTime() > Date.now() ? 'scheduled' : 'queued';
  } else if (input.delayMs) {
    runAt = new Date(Date.now() + input.delayMs);
    jobType = 'delayed';
    status = 'scheduled';
  }

  return withTransaction(async (client) => {
    const result = await client.query<Job>(
      `INSERT INTO jobs (queue_id, project_id, job_type, task_name, payload, priority, status, run_at, retry_policy_id, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        queueId,
        projectId,
        jobType,
        input.taskName,
        JSON.stringify(input.payload ?? {}),
        input.priority ?? 0,
        status,
        runAt.toISOString(),
        input.retryPolicyId ?? null,
        input.idempotencyKey ?? null,
      ]
    );
    const job = result.rows[0];

    if (input.dependsOnJobIds && input.dependsOnJobIds.length > 0) {
      for (const depId of input.dependsOnJobIds) {
        await client.query(
          `INSERT INTO job_dependencies (job_id, depends_on_job_id) VALUES ($1, $2)`,
          [job.id, depId]
        );
      }
    }

    return job;
  }).then((job) => {
    publishEvent(projectId, 'job.created', { jobId: job.id, queueId, status: job.status });
    return job;
  });
}

/** Creates many jobs atomically as one batch, sharing a batch_id. */
export async function createBatch(
  queueId: string,
  projectId: string,
  jobs: CreateJobInput[]
): Promise<{ batchId: string; jobs: Job[] }> {
  const batchId = uuidv4();
  const created = await withTransaction(async (client) => {
    const rows: Job[] = [];
    for (const input of jobs) {
      const runAt = input.runAt ? new Date(input.runAt) : new Date();
      const status = runAt.getTime() > Date.now() ? 'scheduled' : 'queued';
      const result = await client.query<Job>(
        `INSERT INTO jobs (queue_id, project_id, job_type, task_name, payload, priority, status, run_at, retry_policy_id, batch_id)
         VALUES ($1, $2, 'batch', $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          queueId,
          projectId,
          input.taskName,
          JSON.stringify(input.payload ?? {}),
          input.priority ?? 0,
          status,
          runAt.toISOString(),
          input.retryPolicyId ?? null,
          batchId,
        ]
      );
      rows.push(result.rows[0]);
    }
    return rows;
  });
  publishEvent(projectId, 'batch.created', { batchId, count: created.length, queueId });
  return { batchId, jobs: created };
}

export async function getBatchStatus(batchId: string) {
  const result = await query<Job>(`SELECT * FROM jobs WHERE batch_id = $1 ORDER BY created_at ASC`, [
    batchId,
  ]);
  if (result.rows.length === 0) throw new NotFoundError('Batch');
  const counts: Record<string, number> = {};
  for (const j of result.rows) counts[j.status] = (counts[j.status] ?? 0) + 1;
  return { batchId, total: result.rows.length, byStatus: counts, jobs: result.rows };
}

// ----------------------------------------------------------------------------
// ATOMIC CLAIM — the reliability-critical operation.
// ----------------------------------------------------------------------------

/**
 * Atomically claims up to `limit` queued, due jobs from a single queue for
 * `workerId`, honoring the queue's pause flag and max_concurrency.
 *
 * Concurrency safety: uses `FOR UPDATE SKIP LOCKED` inside a single
 * statement (CTE chain + UPDATE ... FROM). Postgres takes row locks on the
 * candidate set during the scan; any other transaction running the same
 * query concurrently skips rows already locked rather than blocking or
 * double-claiming them. This guarantees each job is claimed by exactly one
 * worker even with many workers polling the same queue simultaneously.
 * (Verified under concurrent load in tests/concurrency.test.ts.)
 */
export async function claimJobs(queueId: string, workerId: string, limit: number, leaseMs: number): Promise<Job[]> {
  const result = await query<Job>(
    `WITH queue_info AS (
       SELECT max_concurrency FROM queues WHERE id = $1 AND is_paused = false
     ),
     current_load AS (
       SELECT COUNT(*)::int AS running_count FROM jobs
       WHERE queue_id = $1 AND status IN ('claimed', 'running')
     ),
     available AS (
       SELECT GREATEST(
         0,
         LEAST($2::int, COALESCE((SELECT max_concurrency FROM queue_info), 0) - (SELECT running_count FROM current_load))
       ) AS n
     ),
     candidate AS (
       SELECT id FROM jobs
       WHERE queue_id = $1 AND status = 'queued' AND run_at <= now()
       ORDER BY priority DESC, run_at ASC
       LIMIT (SELECT n FROM available)
       FOR UPDATE SKIP LOCKED
     )
     UPDATE jobs
     SET status = 'claimed', claimed_by = $3, claimed_at = now(),
         locked_until = now() + ($4 || ' milliseconds')::interval
     FROM candidate
     WHERE jobs.id = candidate.id
     RETURNING jobs.*`,
    [queueId, limit, workerId, leaseMs]
  );
  if (result.rows.length > 0) {
    publishEvent(result.rows[0].project_id, 'job.claimed', {
      queueId,
      workerId,
      jobIds: result.rows.map((j) => j.id),
    });
  }
  return result.rows;
}

/** Transitions a claimed job to running and opens its execution record. */
export async function startExecution(jobId: string, workerId: string): Promise<{ executionId: string; attemptNumber: number }> {
  return withTransaction(async (client) => {
    const jobRes = await client.query<Job>(
      `UPDATE jobs SET status = 'running' WHERE id = $1 AND claimed_by = $2 AND status = 'claimed' RETURNING *`,
      [jobId, workerId]
    );
    if (jobRes.rows.length === 0) {
      throw new ConflictError('Job is not in claimed state for this worker (lease may have expired)');
    }
    const job = jobRes.rows[0];
    const attemptNumber = job.attempt_count + 1;
    const execRes = await client.query(
      `INSERT INTO job_executions (job_id, worker_id, attempt_number, status)
       VALUES ($1, $2, $3, 'running') RETURNING id`,
      [jobId, workerId, attemptNumber]
    );
    return { executionId: execRes.rows[0].id, attemptNumber };
  });
}

/** Extends a running job's lease. Fenced: only succeeds if the caller still owns the claim. */
export async function extendLease(jobId: string, workerId: string, leaseMs: number): Promise<boolean> {
  const result = await query(
    `UPDATE jobs SET locked_until = now() + ($3 || ' milliseconds')::interval
     WHERE id = $1 AND claimed_by = $2 AND status IN ('claimed', 'running')`,
    [jobId, workerId, leaseMs]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function completeJob(
  jobId: string,
  executionId: string,
  result: Record<string, unknown>
): Promise<void> {
  await withTransaction(async (client) => {
    const execRes = await client.query(
      `UPDATE job_executions
       SET status = 'succeeded', finished_at = now(),
           duration_ms = EXTRACT(EPOCH FROM (now() - started_at)) * 1000,
           result = $2
       WHERE id = $1 RETURNING job_id`,
      [executionId, JSON.stringify(result)]
    );
    const jobId2 = execRes.rows[0].job_id;

    await client.query(
      `UPDATE jobs SET status = 'completed', attempt_count = attempt_count + 1,
              result = $2, last_error = NULL, claimed_by = NULL, claimed_at = NULL, locked_until = NULL
       WHERE id = $1`,
      [jobId2, JSON.stringify(result)]
    );

    // Resolve any dependents whose last unmet dependency was this job.
    await client.query(
      `UPDATE jobs
       SET status = (CASE WHEN run_at <= now() THEN 'queued' ELSE 'scheduled' END)::job_status
       WHERE status = 'waiting_deps'
         AND id IN (SELECT job_id FROM job_dependencies WHERE depends_on_job_id = $1)
         AND NOT EXISTS (
           SELECT 1 FROM job_dependencies jd
           JOIN jobs dep ON dep.id = jd.depends_on_job_id
           WHERE jd.job_id = jobs.id AND dep.status <> 'completed'
         )`,
      [jobId]
    );
  });

  const job = await getJob(jobId);
  publishEvent(job.project_id, 'job.completed', { jobId, queueId: job.queue_id });
}

/**
 * Records a failed attempt and either schedules a retry (per the job's
 * retry policy) or moves the job permanently to the Dead Letter Queue.
 */
export async function failJob(
  jobId: string,
  executionId: string,
  errorMessage: string,
  errorStack?: string
): Promise<{ retried: boolean; nextRunAt?: string }> {
  return withTransaction(async (client) => {
    await client.query(
      `UPDATE job_executions
       SET status = 'failed', finished_at = now(),
           duration_ms = EXTRACT(EPOCH FROM (now() - started_at)) * 1000,
           error_message = $2, error_stack = $3
       WHERE id = $1`,
      [executionId, errorMessage, errorStack ?? null]
    );

    const jobRes = await client.query<Job>(`SELECT * FROM jobs WHERE id = $1 FOR UPDATE`, [jobId]);
    const job = jobRes.rows[0];
    if (!job) throw new NotFoundError('Job');

    const newAttemptCount = job.attempt_count + 1;
    const policy = await getRetryPolicyConfig(job.retry_policy_id);

    if (shouldRetry(newAttemptCount, policy)) {
      const delayMs = computeBackoffMs(newAttemptCount, policy);
      const nextRunAt = new Date(Date.now() + delayMs);
      await client.query(
        `UPDATE jobs
         SET status = 'scheduled', attempt_count = $2, run_at = $3, last_error = $4,
             claimed_by = NULL, claimed_at = NULL, locked_until = NULL
         WHERE id = $1`,
        [jobId, newAttemptCount, nextRunAt.toISOString(), errorMessage]
      );
      publishEvent(job.project_id, 'job.retry_scheduled', {
        jobId,
        queueId: job.queue_id,
        attempt: newAttemptCount,
        nextRunAt: nextRunAt.toISOString(),
      });
      return { retried: true, nextRunAt: nextRunAt.toISOString() };
    } else {
      await client.query(
        `UPDATE jobs
         SET status = 'dead_letter', attempt_count = $2, last_error = $3,
             claimed_by = NULL, claimed_at = NULL, locked_until = NULL
         WHERE id = $1`,
        [jobId, newAttemptCount, errorMessage]
      );
      await client.query(
        `INSERT INTO dead_letter_entries (job_id, queue_id, task_name, payload_snapshot, attempt_count, final_error, original_created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (job_id) DO NOTHING`,
        [jobId, job.queue_id, job.task_name, JSON.stringify(job.payload), newAttemptCount, errorMessage, job.created_at]
      );
      publishEvent(job.project_id, 'job.dead_lettered', { jobId, queueId: job.queue_id, error: errorMessage });
      return { retried: false };
    }
  });
}

export async function cancelJob(jobId: string): Promise<Job> {
  const result = await query<Job>(
    `UPDATE jobs SET status = 'cancelled'
     WHERE id = $1 AND status IN ('queued', 'scheduled', 'waiting_deps', 'claimed')
     RETURNING *`,
    [jobId]
  );
  if (result.rows.length === 0) {
    throw new ConflictError('Job cannot be cancelled in its current state');
  }
  return result.rows[0];
}

export async function getJob(jobId: string): Promise<Job> {
  const result = await query<Job>(`SELECT * FROM jobs WHERE id = $1`, [jobId]);
  if (result.rows.length === 0) throw new NotFoundError('Job');
  return result.rows[0];
}

export async function getJobDetail(jobId: string) {
  const job = await getJob(jobId);
  const executions = await query(
    `SELECT * FROM job_executions WHERE job_id = $1 ORDER BY attempt_number DESC`,
    [jobId]
  );
  const logs = await query(
    `SELECT * FROM job_logs WHERE job_id = $1 ORDER BY created_at ASC LIMIT 500`,
    [jobId]
  );
  const dependencies = await query(
    `SELECT jd.depends_on_job_id, j.status FROM job_dependencies jd
     JOIN jobs j ON j.id = jd.depends_on_job_id WHERE jd.job_id = $1`,
    [jobId]
  );
  return { job, executions: executions.rows, logs: logs.rows, dependencies: dependencies.rows };
}

export interface ListJobsFilter {
  queueId?: string;
  projectId?: string;
  status?: string;
  taskName?: string;
  page: number;
  pageSize: number;
}

export async function listJobs(filter: ListJobsFilter) {
  const conditions: string[] = [];
  const params: any[] = [];
  let i = 1;

  if (filter.queueId) {
    conditions.push(`queue_id = $${i++}`);
    params.push(filter.queueId);
  }
  if (filter.projectId) {
    conditions.push(`project_id = $${i++}`);
    params.push(filter.projectId);
  }
  if (filter.status) {
    conditions.push(`status = $${i++}`);
    params.push(filter.status);
  }
  if (filter.taskName) {
    conditions.push(`task_name = $${i++}`);
    params.push(filter.taskName);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (filter.page - 1) * filter.pageSize;

  const countRes = await query(`SELECT COUNT(*)::int AS total FROM jobs ${whereClause}`, params);
  const rowsRes = await query(
    `SELECT * FROM jobs ${whereClause} ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i++}`,
    [...params, filter.pageSize, offset]
  );

  return { total: countRes.rows[0].total as number, jobs: rowsRes.rows };
}

/** Appends a structured log line to a job's execution trail. */
export async function appendJobLog(
  jobId: string,
  executionId: string | null,
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string
): Promise<void> {
  await query(
    `INSERT INTO job_logs (job_id, execution_id, level, message) VALUES ($1, $2, $3, $4)`,
    [jobId, executionId, level, message]
  );
}
