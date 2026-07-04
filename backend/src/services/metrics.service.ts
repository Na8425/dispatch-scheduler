import { query } from '../config/db';

/** Throughput time series bucketed per minute for the last `minutes` window. */
export async function getThroughputSeries(projectId: string, minutes = 60) {
  const result = await query(
    `SELECT
        date_trunc('minute', je.finished_at) AS bucket,
        COUNT(*) FILTER (WHERE je.status = 'succeeded')::int AS completed,
        COUNT(*) FILTER (WHERE je.status = 'failed')::int AS failed
     FROM job_executions je
     JOIN jobs j ON j.id = je.job_id
     WHERE j.project_id = $1 AND je.finished_at > now() - ($2 || ' minutes')::interval
     GROUP BY bucket
     ORDER BY bucket ASC`,
    [projectId, minutes]
  );
  return result.rows;
}

export async function getProjectHealth(projectId: string) {
  const jobCounts = await query(
    `SELECT status, COUNT(*)::int AS count FROM jobs WHERE project_id = $1 GROUP BY status`,
    [projectId]
  );
  const workerCounts = await query(
    `SELECT status, COUNT(*)::int AS count FROM workers WHERE project_id = $1 GROUP BY status`,
    [projectId]
  );
  const dlqCount = await query(
    `SELECT COUNT(*)::int AS count FROM dead_letter_entries de
     JOIN queues q ON q.id = de.queue_id WHERE q.project_id = $1 AND de.requeued_at IS NULL`,
    [projectId]
  );

  const byStatus: Record<string, number> = {};
  for (const r of jobCounts.rows) byStatus[r.status] = r.count;
  const workersByStatus: Record<string, number> = {};
  for (const r of workerCounts.rows) workersByStatus[r.status] = r.count;

  return {
    jobsByStatus: byStatus,
    workersByStatus,
    unresolvedDeadLetterCount: dlqCount.rows[0].count as number,
  };
}
