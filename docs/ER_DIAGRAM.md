# Entity-Relationship Diagram

Full DDL: [`backend/src/db/migrations/001_init.sql`](../backend/src/db/migrations/001_init.sql)
(applied and verified against a live PostgreSQL 16 instance during development).

```mermaid
erDiagram
    USERS ||--o{ ORGANIZATION_MEMBERS : "belongs to orgs via"
    ORGANIZATIONS ||--o{ ORGANIZATION_MEMBERS : has
    ORGANIZATIONS ||--o{ PROJECTS : owns
    PROJECTS ||--o{ RETRY_POLICIES : defines
    PROJECTS ||--o{ QUEUES : owns
    PROJECTS ||--o{ WORKERS : "workers register to"
    QUEUES ||--o{ JOBS : contains
    QUEUES ||--o{ SCHEDULED_JOBS : "cron defs for"
    QUEUES }o--o| RETRY_POLICIES : "default policy"
    JOBS }o--o| RETRY_POLICIES : "uses"
    JOBS ||--o{ JOB_EXECUTIONS : "attempts"
    JOBS ||--o{ JOB_LOGS : "log lines"
    JOBS ||--o{ JOB_DEPENDENCIES : "depends on (self-referencing)"
    JOBS ||--o| DEAD_LETTER_ENTRIES : "permanently failed into"
    SCHEDULED_JOBS ||--o{ JOBS : spawns
    WORKERS ||--o{ JOB_EXECUTIONS : "executed by"
    WORKERS ||--o{ WORKER_HEARTBEATS : "reports"

    USERS {
        uuid id PK
        citext email UK
        text password_hash
        text name
    }
    ORGANIZATIONS {
        uuid id PK
        text name
        text slug UK
        uuid owner_id FK
    }
    ORGANIZATION_MEMBERS {
        uuid org_id PK_FK
        uuid user_id PK_FK
        org_role role
    }
    PROJECTS {
        uuid id PK
        uuid org_id FK
        text name
        text api_key_hash UK
    }
    RETRY_POLICIES {
        uuid id PK
        uuid project_id FK
        text name
        retry_strategy strategy
        int base_delay_ms
        numeric multiplier
        int max_delay_ms
        int max_attempts
        bool jitter
    }
    QUEUES {
        uuid id PK
        uuid project_id FK
        text name
        smallint priority
        int max_concurrency
        bool is_paused
        uuid default_retry_policy_id FK
        int rate_limit_per_sec
    }
    JOBS {
        uuid id PK
        uuid queue_id FK
        uuid project_id FK
        job_type job_type
        text task_name
        jsonb payload
        smallint priority
        job_status status
        timestamptz run_at
        int attempt_count
        uuid retry_policy_id FK
        text idempotency_key
        uuid claimed_by FK
        timestamptz claimed_at
        timestamptz locked_until
        uuid batch_id
        uuid scheduled_job_id FK
        jsonb result
        text last_error
    }
    JOB_DEPENDENCIES {
        uuid job_id PK_FK
        uuid depends_on_job_id PK_FK
    }
    JOB_EXECUTIONS {
        uuid id PK
        uuid job_id FK
        uuid worker_id FK
        int attempt_number
        execution_status status
        timestamptz started_at
        timestamptz finished_at
        int duration_ms
        text error_message
        text error_stack
        jsonb result
    }
    JOB_LOGS {
        bigserial id PK
        uuid job_id FK
        uuid execution_id FK
        log_level level
        text message
        timestamptz created_at
    }
    SCHEDULED_JOBS {
        uuid id PK
        uuid queue_id FK
        text name
        text task_name
        jsonb payload_template
        text cron_expression
        text timezone
        bool is_active
        timestamptz next_run_at
        timestamptz last_run_at
    }
    DEAD_LETTER_ENTRIES {
        uuid id PK
        uuid job_id FK UK
        uuid queue_id FK
        text task_name
        jsonb payload_snapshot
        int attempt_count
        text final_error
        timestamptz moved_at
        timestamptz requeued_at
    }
    WORKERS {
        uuid id PK
        uuid project_id FK
        text hostname
        int pid
        worker_status status
        int concurrency_capacity
        int current_load
        timestamptz last_heartbeat_at
    }
    WORKER_HEARTBEATS {
        bigserial id PK
        uuid worker_id FK
        timestamptz heartbeat_at
        int active_job_count
        real cpu_load
        real memory_mb
    }
```

## Key design decisions

### Normalization

The schema is in 3NF with two deliberate, documented exceptions:

- **`jobs.project_id` is denormalized** (derivable via `jobs.queue_id → queues.project_id`).
  This is intentional: the hot-path claim query and the job-explorer filter query both
  need to scope by project or queue without an extra join, and `project_id` never changes
  once a job is created, so there's no update-anomaly risk — only a one-time write cost.
- **`workers.last_heartbeat_at` / `current_load` duplicate the latest row of
  `worker_heartbeats`.** The heartbeats table is the append-only time series (for the
  sparkline chart and audit); the columns on `workers` exist purely so "list workers with
  their current status" is a single-table scan instead of a `GROUP BY ... MAX()` over a
  fast-growing table on every dashboard poll.

Everything else — retry policies pulled out of `queues`/`jobs`, dead-letter entries as
their own audited table rather than just a job status flag, job executions as one row
per attempt rather than columns bolted onto `jobs` — follows normal form because those
are genuinely many-valued or independently-lifecycled facts.

### Primary keys

UUIDs (`gen_random_uuid()`) everywhere except two append-only, purely-internal log tables
(`job_logs`, `worker_heartbeats`), which use `BIGSERIAL`. Reasoning: UUIDs let any process
(API, worker, scheduler) generate a valid ID without a round-trip to get a sequence value,
which matters for a system where inserts originate from many independent processes.
`BIGSERIAL` is fine for the two log tables because they're only ever inserted by whichever
single worker owns that job attempt, and monotonic IDs make time-ordered log retrieval and
future partitioning by ID range simpler.

### Foreign keys & cascade behavior

| Relationship | On delete | Why |
|---|---|---|
| `organization_members → organizations/users` | CASCADE | Membership is meaningless without both sides |
| `projects → organizations` | CASCADE | A project cannot outlive its organization |
| `queues, retry_policies, workers → projects` | CASCADE | Scoped entirely to the project |
| `jobs → queues, projects` | CASCADE | A job has no meaning outside its queue |
| `job_executions, job_logs, job_dependencies → jobs` | CASCADE | Pure audit/child data |
| `job_executions.worker_id → workers` | **SET NULL** | Deliberately *not* CASCADE — decommissioning a worker must not delete the execution history it produced. The audit trail survives; only the worker attribution is nulled. |
| `dead_letter_entries → jobs` | CASCADE, but... | ...`dead_letter_entries` also stores a full **snapshot** (`payload_snapshot`, `task_name`, `attempt_count`, `final_error`) at time of failure, precisely so the DLQ audit record has value even independent of whether the parent job row is later purged by a retention job. |
| `organizations.owner_id → users` | RESTRICT | Prevents silently deleting a user who still owns an organization; forces an explicit ownership transfer first. |

### Indexing strategy

Every index is justified by a specific query in the codebase, not added speculatively:

| Index | Serves |
|---|---|
| `idx_jobs_claim (queue_id, status, priority DESC, run_at ASC) WHERE status='queued'` | The atomic claim query — this is the index that makes worker polling cheap even with millions of historical job rows, since the partial index only ever contains currently-claimable jobs |
| `idx_jobs_promote (run_at) WHERE status='scheduled'` | The scheduler's promotion scan |
| `idx_jobs_lease_expiry (locked_until) WHERE status IN ('claimed','running')` | The reaper's crashed-worker scan |
| `idx_jobs_queue_status_created` | Job Explorer filter + pagination |
| `uq_jobs_idempotency` (partial unique) | Enforces the idempotency-key contract at the DB level, not just in application code |
| `idx_heartbeats_worker_time` | Worker detail sparkline (`ORDER BY heartbeat_at DESC LIMIT n`) |
| `idx_scheduled_jobs_due` | Cron ticker's due-definition scan |

All the hot-path indexes on `jobs` are **partial indexes** (`WHERE status = ...`) rather
than full-table indexes. Since the overwhelming majority of historical rows end up
`completed`, a partial index keeps the claim/promote/reap indexes small and fast
regardless of how large the completed-job history grows.
