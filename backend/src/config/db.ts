import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { env } from './env';
import { logger } from '../utils/logger';

export const pool = new Pool({
  connectionString: env.databaseUrl,
  max: env.dbPoolMax,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  // Idle client errors (e.g. connection dropped) must not crash the process.
  logger.error({ err }, 'Unexpected Postgres pool error on idle client');
});

export async function query<T extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> {
  const start = Date.now();
  const result = await pool.query<T>(text, params);
  const durationMs = Date.now() - start;
  if (durationMs > 200) {
    logger.warn({ durationMs, query: text.slice(0, 120) }, 'Slow query');
  }
  return result;
}

/**
 * Runs `fn` inside a single transaction on a dedicated client.
 * Always use this (never `pool.query`) for multi-statement sequences that
 * must be atomic, e.g. claim-job, complete-job-and-schedule-retry.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
