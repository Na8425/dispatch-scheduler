import { query, withTransaction } from '../config/db';
import { NotFoundError, ConflictError } from '../utils/errors';
import { publishEvent } from '../ws/events';

export async function listDeadLetterEntries(queueId: string, page: number, pageSize: number) {
  const offset = (page - 1) * pageSize;
  const countRes = await query(`SELECT COUNT(*)::int AS total FROM dead_letter_entries WHERE queue_id = $1`, [
    queueId,
  ]);
  const rowsRes = await query(
    `SELECT * FROM dead_letter_entries WHERE queue_id = $1 ORDER BY moved_at DESC LIMIT $2 OFFSET $3`,
    [queueId, pageSize, offset]
  );
  return { total: countRes.rows[0].total as number, entries: rowsRes.rows };
}

/**
 * Requeues a dead-lettered job: resets the original job row back to
 * `queued` with a fresh attempt count, and stamps the DLQ entry as
 * requeued (kept for audit rather than deleted).
 */
export async function requeueFromDeadLetter(dlqEntryId: string, userId: string) {
  return withTransaction(async (client) => {
    const dlqRes = await client.query(`SELECT * FROM dead_letter_entries WHERE id = $1 FOR UPDATE`, [
      dlqEntryId,
    ]);
    const entry = dlqRes.rows[0];
    if (!entry) throw new NotFoundError('Dead letter entry');
    if (entry.requeued_at) throw new ConflictError('This entry has already been requeued');

    const jobRes = await client.query(
      `UPDATE jobs
       SET status = 'queued', attempt_count = 0, run_at = now(), last_error = NULL,
           claimed_by = NULL, claimed_at = NULL, locked_until = NULL
       WHERE id = $1 RETURNING *`,
      [entry.job_id]
    );

    await client.query(
      `UPDATE dead_letter_entries SET requeued_at = now(), requeued_by = $2 WHERE id = $1`,
      [dlqEntryId, userId]
    );

    return jobRes.rows[0];
  }).then((job) => {
    publishEvent(job.project_id, 'job.requeued', { jobId: job.id, queueId: job.queue_id });
    return job;
  });
}
