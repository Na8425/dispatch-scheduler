export type OrgRole = 'owner' | 'admin' | 'member' | 'viewer';

export type JobStatus =
  | 'waiting_deps'
  | 'scheduled'
  | 'queued'
  | 'claimed'
  | 'running'
  | 'completed'
  | 'failed'
  | 'dead_letter'
  | 'cancelled';

export type JobType = 'immediate' | 'delayed' | 'scheduled' | 'recurring' | 'batch';

export type ExecutionStatus = 'running' | 'succeeded' | 'failed' | 'timed_out';

export type WorkerStatus = 'online' | 'draining' | 'offline';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface JwtPayload {
  sub: string; // user id
  email: string;
}

export interface Job {
  id: string;
  queue_id: string;
  project_id: string;
  job_type: JobType;
  task_name: string;
  payload: Record<string, unknown>;
  priority: number;
  status: JobStatus;
  run_at: string;
  attempt_count: number;
  retry_policy_id: string | null;
  idempotency_key: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  locked_until: string | null;
  batch_id: string | null;
  scheduled_job_id: string | null;
  result: Record<string, unknown> | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}
