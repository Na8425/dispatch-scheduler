import { query } from '../config/db';
import { NotFoundError } from '../utils/errors';

export interface CreateQueueInput {
  name: string;
  priority?: number;
  maxConcurrency?: number;
  retryPolicyId?: string | null;
  rateLimitPerSec?: number | null;
}

export async function createQueue(projectId: string, input: CreateQueueInput) {
  const result = await query(
    `INSERT INTO queues (project_id, name, priority, max_concurrency, default_retry_policy_id, rate_limit_per_sec)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      projectId,
      input.name,
      input.priority ?? 0,
      input.maxConcurrency ?? 5,
      input.retryPolicyId ?? null,
      input.rateLimitPerSec ?? null,
    ]
  );
  return result.rows[0];
}

export async function listQueues(projectId: string) {
  const result = await query(`SELECT * FROM queues WHERE project_id = $1 ORDER BY created_at DESC`, [
    projectId,
  ]);
  return result.rows;
}

export async function getQueue(queueId: string) {
  const result = await query(`SELECT * FROM queues WHERE id = $1`, [queueId]);
  if (result.rows.length === 0) throw new NotFoundError('Queue');
  return result.rows[0];
}

export async function updateQueue(queueId: string, updates: Partial<CreateQueueInput>) {
  const fields: string[] = [];
  const values: any[] = [];
  let i = 1;

  const map: Record<string, any> = {
    name: updates.name,
    priority: updates.priority,
    max_concurrency: updates.maxConcurrency,
    default_retry_policy_id: updates.retryPolicyId,
    rate_limit_per_sec: updates.rateLimitPerSec,
  };

  for (const [col, val] of Object.entries(map)) {
    if (val !== undefined) {
      fields.push(`${col} = $${i++}`);
      values.push(val);
    }
  }

  if (fields.length === 0) return getQueue(queueId);

  values.push(queueId);
  const result = await query(
    `UPDATE queues SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
    values
  );
  if (result.rows.length === 0) throw new NotFoundError('Queue');
  return result.rows[0];
}

export async function setQueuePaused(queueId: string, paused: boolean) {
  const result = await query(`UPDATE queues SET is_paused = $1 WHERE id = $2 RETURNING *`, [
    paused,
    queueId,
  ]);
  if (result.rows.length === 0) throw new NotFoundError('Queue');
  return result.rows[0];
}

/**
 * Aggregated queue stats: job counts per status, plus rolling throughput
 * and failure rate over the last hour. Single query using FILTER clauses
 * to avoid N+1 round trips from the dashboard.
 */
export async function getQueueStats(queueId: string) {
  const statusCounts = await query(
    `SELECT status, COUNT(*)::int AS count
     FROM jobs WHERE queue_id = $1
     GROUP BY status`,
    [queueId]
  );

  const throughput = await query(
    `SELECT
        COUNT(*) FILTER (WHERE status = 'completed' AND updated_at > now() - interval '1 hour')::int AS completed_last_hour,
        COUNT(*) FILTER (WHERE status = 'dead_letter' AND updated_at > now() - interval '1 hour')::int AS dead_lettered_last_hour,
        AVG(EXTRACT(EPOCH FROM (je.finished_at - je.started_at)) * 1000) FILTER (WHERE je.status = 'succeeded' AND je.finished_at > now() - interval '1 hour') AS avg_duration_ms_last_hour
     FROM jobs j
     LEFT JOIN job_executions je ON je.job_id = j.id
     WHERE j.queue_id = $1`,
    [queueId]
  );

  const byStatus: Record<string, number> = {};
  for (const row of statusCounts.rows) byStatus[row.status] = row.count;

  return {
    byStatus,
    completedLastHour: throughput.rows[0]?.completed_last_hour ?? 0,
    deadLetteredLastHour: throughput.rows[0]?.dead_lettered_last_hour ?? 0,
    avgDurationMsLastHour: throughput.rows[0]?.avg_duration_ms_last_hour
      ? Math.round(throughput.rows[0].avg_duration_ms_last_hour)
      : null,
  };
}
