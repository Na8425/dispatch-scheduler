import { query } from '../config/db';
import { NotFoundError } from '../utils/errors';
import { RetryPolicyConfig } from '../utils/backoff';

export interface CreateRetryPolicyInput {
  name: string;
  strategy: 'fixed' | 'linear' | 'exponential';
  baseDelayMs?: number;
  multiplier?: number;
  maxDelayMs?: number;
  maxAttempts?: number;
  jitter?: boolean;
}

export async function createRetryPolicy(projectId: string, input: CreateRetryPolicyInput) {
  const result = await query(
    `INSERT INTO retry_policies (project_id, name, strategy, base_delay_ms, multiplier, max_delay_ms, max_attempts, jitter)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      projectId,
      input.name,
      input.strategy,
      input.baseDelayMs ?? 1000,
      input.multiplier ?? 2.0,
      input.maxDelayMs ?? 300000,
      input.maxAttempts ?? 5,
      input.jitter ?? true,
    ]
  );
  return result.rows[0];
}

export async function listRetryPolicies(projectId: string) {
  const result = await query(`SELECT * FROM retry_policies WHERE project_id = $1 ORDER BY created_at DESC`, [
    projectId,
  ]);
  return result.rows;
}

export async function getRetryPolicyConfig(retryPolicyId: string | null): Promise<RetryPolicyConfig> {
  if (!retryPolicyId) {
    // Sensible default when a job/queue has no explicit policy attached.
    return {
      strategy: 'exponential',
      baseDelayMs: 1000,
      multiplier: 2,
      maxDelayMs: 300000,
      maxAttempts: 5,
      jitter: true,
    };
  }
  const result = await query(
    `SELECT strategy, base_delay_ms, multiplier, max_delay_ms, max_attempts, jitter
     FROM retry_policies WHERE id = $1`,
    [retryPolicyId]
  );
  if (result.rows.length === 0) throw new NotFoundError('Retry policy');
  const row = result.rows[0];
  return {
    strategy: row.strategy,
    baseDelayMs: row.base_delay_ms,
    multiplier: parseFloat(row.multiplier),
    maxDelayMs: row.max_delay_ms,
    maxAttempts: row.max_attempts,
    jitter: row.jitter,
  };
}
