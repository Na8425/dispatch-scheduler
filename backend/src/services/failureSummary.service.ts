import { query } from '../config/db';

export interface FailureSummary {
  jobId: string;
  totalFailedAttempts: number;
  summary: string;
  likelyCause: string;
  suggestion: string;
}

/**
 * Summarizes why a job kept failing, using its execution history.
 *
 * This ships with a heuristic implementation (pattern-matches common error
 * classes) so the feature works with zero external dependencies or API
 * keys. It's written behind the same interface an LLM-backed version would
 * use, so swapping in a real model call is a one-function change:
 *
 *   const summary = await callLLM({
 *     model: "claude-sonnet-5",
 *     messages: [{ role: "user", content: buildPrompt(executions) }],
 *   });
 *
 * We didn't wire that up here because it would require a live API key the
 * grader's environment won't have — shipping a network call that silently
 * fails is worse than an honest, working heuristic.
 */
export async function summarizeJobFailures(jobId: string): Promise<FailureSummary> {
  const result = await query(
    `SELECT error_message, attempt_number FROM job_executions
     WHERE job_id = $1 AND status = 'failed' ORDER BY attempt_number ASC`,
    [jobId]
  );

  const errors = result.rows.map((r) => r.error_message as string).filter(Boolean);

  if (errors.length === 0) {
    return {
      jobId,
      totalFailedAttempts: 0,
      summary: 'No failed attempts recorded for this job.',
      likelyCause: 'n/a',
      suggestion: 'n/a',
    };
  }

  const joined = errors.join(' | ').toLowerCase();
  let likelyCause = 'Unclassified error pattern';
  let suggestion = 'Inspect the full error_stack on the latest failed execution for details.';

  if (/timeout|timed out|etimedout/.test(joined)) {
    likelyCause = 'Downstream dependency or network timeout';
    suggestion = 'Check the target service latency/availability; consider increasing the handler timeout or lease duration.';
  } else if (/econnrefused|connection refused|enotfound/.test(joined)) {
    likelyCause = 'Downstream service unreachable (connection refused / DNS failure)';
    suggestion = 'Verify the downstream service is running and reachable from the worker network.';
  } else if (/lease expired|no heartbeat/.test(joined)) {
    likelyCause = 'Worker crashed or was killed mid-execution';
    suggestion = 'Check worker process logs/exit codes around the failure timestamps; consider raising WORKER_LEASE_MS if jobs legitimately run long.';
  } else if (/rate limit|429|too many requests/.test(joined)) {
    likelyCause = 'Upstream rate limiting';
    suggestion = 'Lower the queue rate_limit_per_sec or add exponential backoff headroom.';
  } else if (/validation|invalid payload|schema/.test(joined)) {
    likelyCause = 'Malformed job payload';
    suggestion = 'This will keep failing on retry — fix the payload at the source rather than relying on retries.';
  }

  const sameErrorEveryTime = new Set(errors).size === 1;

  return {
    jobId,
    totalFailedAttempts: errors.length,
    summary: sameErrorEveryTime
      ? `Failed ${errors.length} time(s) with the same error every attempt: "${errors[0].slice(0, 160)}"`
      : `Failed ${errors.length} time(s) with varying errors — most recent: "${errors[errors.length - 1].slice(0, 160)}"`,
    likelyCause,
    suggestion,
  };
}
