import { query } from '../config/db';
import { NotFoundError } from '../utils/errors';

export async function registerWorker(
  projectId: string,
  hostname: string,
  pid: number,
  concurrencyCapacity: number,
  version: string
) {
  const result = await query(
    `INSERT INTO workers (project_id, hostname, pid, concurrency_capacity, version, status)
     VALUES ($1, $2, $3, $4, $5, 'online')
     RETURNING *`,
    [projectId, hostname, pid, concurrencyCapacity, version]
  );
  return result.rows[0];
}

export async function recordHeartbeat(
  workerId: string,
  activeJobCount: number,
  cpuLoad?: number,
  memoryMb?: number
) {
  await query(
    `UPDATE workers SET last_heartbeat_at = now(), current_load = $2, status = 'online'
     WHERE id = $1`,
    [workerId, activeJobCount]
  );
  await query(
    `INSERT INTO worker_heartbeats (worker_id, active_job_count, cpu_load, memory_mb)
     VALUES ($1, $2, $3, $4)`,
    [workerId, activeJobCount, cpuLoad ?? null, memoryMb ?? null]
  );
}

export async function setWorkerStatus(workerId: string, status: 'online' | 'draining' | 'offline') {
  const stoppedAt = status === 'offline' ? 'now()' : 'NULL';
  await query(`UPDATE workers SET status = $2, stopped_at = ${stoppedAt} WHERE id = $1`, [
    workerId,
    status,
  ]);
}

export async function listWorkers(projectId: string) {
  const result = await query(
    `SELECT *,
       (last_heartbeat_at < now() - interval '30 seconds' AND status = 'online') AS is_stale
     FROM workers WHERE project_id = $1 ORDER BY started_at DESC`,
    [projectId]
  );
  return result.rows;
}

export async function getWorker(workerId: string) {
  const result = await query(`SELECT * FROM workers WHERE id = $1`, [workerId]);
  if (result.rows.length === 0) throw new NotFoundError('Worker');
  return result.rows[0];
}

export async function getWorkerHeartbeatHistory(workerId: string, limitPoints = 100) {
  const result = await query(
    `SELECT heartbeat_at, active_job_count, cpu_load, memory_mb
     FROM worker_heartbeats WHERE worker_id = $1
     ORDER BY heartbeat_at DESC LIMIT $2`,
    [workerId, limitPoints]
  );
  return result.rows.reverse();
}

/**
 * Marks workers as offline if they haven't sent a heartbeat within the
 * lease window — called periodically by the scheduler process. This is
 * purely a status/observability update; the actual reclaiming of jobs a
 * dead worker was holding is handled separately by the lease-expiry reaper
 * in scheduler.service.ts (jobs are reclaimed based on their own
 * locked_until, independent of whether we've marked the worker offline yet).
 */
export async function markStaleWorkersOffline(staleAfterMs: number): Promise<number> {
  const result = await query(
    `UPDATE workers SET status = 'offline', stopped_at = now()
     WHERE status = 'online' AND last_heartbeat_at < now() - ($1 || ' milliseconds')::interval`,
    [staleAfterMs]
  );
  return result.rowCount ?? 0;
}
