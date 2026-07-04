-- ============================================================================
-- Distributed Job Scheduler — Initial Schema
-- ============================================================================
-- Design notes (see docs/DESIGN_DECISIONS.md and docs/ER_DIAGRAM.md for the
-- full rationale). Key points inline as comments near the relevant table.

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;   -- case-insensitive email column

-- ----------------------------------------------------------------------------
-- USERS & ORGANIZATIONS
-- ----------------------------------------------------------------------------

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           CITEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    name            TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE organizations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    slug            TEXT NOT NULL UNIQUE,
    owner_id        UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Many-to-many users <-> organizations, with an RBAC role.
-- RESTRICT on org delete prevents orphaning membership rows silently;
-- app layer must explicitly remove members before deleting an org, OR
-- we cascade at the membership level only (child of org), which is safe
-- because membership rows have no further dependents.
CREATE TYPE org_role AS ENUM ('owner', 'admin', 'member', 'viewer');

CREATE TABLE organization_members (
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            org_role NOT NULL DEFAULT 'member',
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (org_id, user_id)
);

CREATE INDEX idx_org_members_user ON organization_members(user_id);

-- ----------------------------------------------------------------------------
-- PROJECTS
-- ----------------------------------------------------------------------------

CREATE TABLE projects (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    api_key_hash    TEXT NOT NULL UNIQUE, -- for worker/service-to-service auth
    created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, name)
);

CREATE INDEX idx_projects_org ON projects(org_id);

-- ----------------------------------------------------------------------------
-- RETRY POLICIES (normalized out so many queues/jobs can share one)
-- ----------------------------------------------------------------------------

CREATE TYPE retry_strategy AS ENUM ('fixed', 'linear', 'exponential');

CREATE TABLE retry_policies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    strategy        retry_strategy NOT NULL DEFAULT 'exponential',
    base_delay_ms   INTEGER NOT NULL DEFAULT 1000 CHECK (base_delay_ms >= 0),
    multiplier      NUMERIC(6,2) NOT NULL DEFAULT 2.0 CHECK (multiplier > 0), -- used by exponential
    max_delay_ms    INTEGER NOT NULL DEFAULT 300000 CHECK (max_delay_ms >= 0),
    max_attempts    INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts >= 1),
    jitter          BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, name)
);

-- ----------------------------------------------------------------------------
-- QUEUES
-- ----------------------------------------------------------------------------

CREATE TABLE queues (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,
    priority            SMALLINT NOT NULL DEFAULT 0, -- higher = served first, tie-broken by job priority
    max_concurrency     INTEGER NOT NULL DEFAULT 5 CHECK (max_concurrency >= 1),
    is_paused           BOOLEAN NOT NULL DEFAULT false,
    default_retry_policy_id UUID REFERENCES retry_policies(id) ON DELETE SET NULL,
    rate_limit_per_sec  INTEGER, -- NULL = unlimited; enforced via Redis token bucket
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, name)
);

CREATE INDEX idx_queues_project ON queues(project_id);

-- ----------------------------------------------------------------------------
-- WORKERS
-- ----------------------------------------------------------------------------

CREATE TYPE worker_status AS ENUM ('online', 'draining', 'offline');

CREATE TABLE workers (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    hostname            TEXT NOT NULL,
    pid                 INTEGER,
    status              worker_status NOT NULL DEFAULT 'online',
    concurrency_capacity INTEGER NOT NULL DEFAULT 5,
    current_load        INTEGER NOT NULL DEFAULT 0,
    version             TEXT,
    started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_heartbeat_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    stopped_at          TIMESTAMPTZ
);

CREATE INDEX idx_workers_project ON workers(project_id);
CREATE INDEX idx_workers_heartbeat ON workers(last_heartbeat_at) WHERE status <> 'offline';

-- Time-series heartbeat history, separate from the denormalized "latest"
-- fields on `workers` (which exist purely so worker-list queries don't need
-- to aggregate). This table feeds the worker health chart and can be
-- partitioned/pruned independently since it's high-write, append-only.
CREATE TABLE worker_heartbeats (
    id              BIGSERIAL PRIMARY KEY,
    worker_id       UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
    heartbeat_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    active_job_count INTEGER NOT NULL DEFAULT 0,
    cpu_load        REAL,
    memory_mb       REAL
);

CREATE INDEX idx_heartbeats_worker_time ON worker_heartbeats(worker_id, heartbeat_at DESC);

-- ----------------------------------------------------------------------------
-- JOBS  (the hot-path table — indexes here are the most performance critical)
-- ----------------------------------------------------------------------------

CREATE TYPE job_status AS ENUM (
    'waiting_deps', -- has unmet workflow dependencies
    'scheduled',    -- run_at is in the future (delayed / one-off scheduled / cron-spawned)
    'queued',       -- ready to be claimed now
    'claimed',      -- claimed by a worker, not yet started
    'running',      -- actively executing
    'completed',
    'failed',       -- terminal for this attempt, but will retry (transient state)
    'dead_letter',  -- exhausted retries, permanent failure
    'cancelled'
);

CREATE TYPE job_type AS ENUM ('immediate', 'delayed', 'scheduled', 'recurring', 'batch');

CREATE TABLE jobs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    queue_id            UUID NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
    -- denormalized for hot-path filtering without a join back to queues
    project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    job_type            job_type NOT NULL DEFAULT 'immediate',
    task_name           TEXT NOT NULL, -- maps to a registered handler, e.g. "send_email"
    payload             JSONB NOT NULL DEFAULT '{}',
    priority            SMALLINT NOT NULL DEFAULT 0, -- higher served first within a queue

    status              job_status NOT NULL DEFAULT 'queued',
    run_at              TIMESTAMPTZ NOT NULL DEFAULT now(), -- earliest eligible execution time

    attempt_count       INTEGER NOT NULL DEFAULT 0,
    retry_policy_id     UUID REFERENCES retry_policies(id) ON DELETE SET NULL,

    idempotency_key     TEXT, -- optional; unique per queue when present

    -- claim/lease fields — the concurrency-critical columns
    claimed_by          UUID REFERENCES workers(id) ON DELETE SET NULL,
    claimed_at          TIMESTAMPTZ,
    locked_until        TIMESTAMPTZ, -- heartbeat lease expiry; reaper reclaims stale leases

    -- batch / workflow grouping
    batch_id            UUID, -- groups jobs submitted together via the batch API
    scheduled_job_id    UUID, -- set when spawned from a recurring cron definition

    result              JSONB,
    last_error          TEXT,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_locked_until_requires_claim
        CHECK (locked_until IS NULL OR claimed_by IS NOT NULL)
);

-- THE core index: supports the atomic claim query exactly as it filters/sorts.
CREATE INDEX idx_jobs_claim ON jobs (queue_id, status, priority DESC, run_at ASC)
    WHERE status = 'queued';

-- Promoter/scheduler scan: scheduled jobs whose time has come.
CREATE INDEX idx_jobs_promote ON jobs (run_at) WHERE status = 'scheduled';

-- Reaper scan: running/claimed jobs whose lease has expired (worker crash).
CREATE INDEX idx_jobs_lease_expiry ON jobs (locked_until)
    WHERE status IN ('claimed', 'running');

-- Job explorer filtering/pagination.
CREATE INDEX idx_jobs_queue_status_created ON jobs (queue_id, status, created_at DESC);
CREATE INDEX idx_jobs_batch ON jobs (batch_id) WHERE batch_id IS NOT NULL;
CREATE INDEX idx_jobs_scheduled_job ON jobs (scheduled_job_id) WHERE scheduled_job_id IS NOT NULL;

-- Idempotency: at most one non-terminal job per (queue, key).
CREATE UNIQUE INDEX uq_jobs_idempotency ON jobs (queue_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL
      AND status NOT IN ('completed', 'dead_letter', 'cancelled');

-- ----------------------------------------------------------------------------
-- JOB DEPENDENCIES (bonus: workflow support — job B waits on job A)
-- ----------------------------------------------------------------------------

CREATE TABLE job_dependencies (
    job_id              UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    depends_on_job_id   UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    PRIMARY KEY (job_id, depends_on_job_id),
    CHECK (job_id <> depends_on_job_id)
);

CREATE INDEX idx_job_deps_depends_on ON job_dependencies(depends_on_job_id);

-- ----------------------------------------------------------------------------
-- JOB EXECUTIONS (one row per attempt — the audit trail)
-- ----------------------------------------------------------------------------

CREATE TYPE execution_status AS ENUM ('running', 'succeeded', 'failed', 'timed_out');

CREATE TABLE job_executions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    worker_id       UUID REFERENCES workers(id) ON DELETE SET NULL, -- keep history if worker is decommissioned
    attempt_number  INTEGER NOT NULL,
    status          execution_status NOT NULL DEFAULT 'running',
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at     TIMESTAMPTZ,
    duration_ms     INTEGER,
    error_message   TEXT,
    error_stack     TEXT,
    result          JSONB,
    UNIQUE (job_id, attempt_number)
);

CREATE INDEX idx_executions_job ON job_executions(job_id, attempt_number DESC);
CREATE INDEX idx_executions_worker ON job_executions(worker_id);
CREATE INDEX idx_executions_started ON job_executions(started_at DESC);

-- ----------------------------------------------------------------------------
-- JOB LOGS (fine-grained log lines within an execution)
-- ----------------------------------------------------------------------------

CREATE TYPE log_level AS ENUM ('debug', 'info', 'warn', 'error');

CREATE TABLE job_logs (
    id              BIGSERIAL PRIMARY KEY,
    job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    execution_id    UUID REFERENCES job_executions(id) ON DELETE CASCADE,
    level           log_level NOT NULL DEFAULT 'info',
    message         TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_job_logs_job_time ON job_logs(job_id, created_at);

-- ----------------------------------------------------------------------------
-- SCHEDULED JOBS (recurring cron *definitions* — templates, not instances)
-- ----------------------------------------------------------------------------
-- A row here is a standing "spawn a job on this cron schedule" definition.
-- Each firing inserts a new row into `jobs` with scheduled_job_id set back
-- to this row, so history of all spawned runs is queryable via that FK.

CREATE TABLE scheduled_jobs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    queue_id            UUID NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,
    task_name           TEXT NOT NULL,
    payload_template    JSONB NOT NULL DEFAULT '{}',
    cron_expression     TEXT NOT NULL,
    timezone            TEXT NOT NULL DEFAULT 'UTC',
    is_active           BOOLEAN NOT NULL DEFAULT true,
    priority            SMALLINT NOT NULL DEFAULT 0,
    retry_policy_id     UUID REFERENCES retry_policies(id) ON DELETE SET NULL,
    next_run_at         TIMESTAMPTZ NOT NULL,
    last_run_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (queue_id, name)
);

CREATE INDEX idx_scheduled_jobs_due ON scheduled_jobs(next_run_at) WHERE is_active = true;

-- ----------------------------------------------------------------------------
-- DEAD LETTER QUEUE (immutable snapshot at time of permanent failure)
-- ----------------------------------------------------------------------------
-- Stored as its own table (rather than just a job status) so the record
-- survives even if the originating job/queue is later purged, and so DLQ
-- listing never has to scan the much larger `jobs` table.

CREATE TABLE dead_letter_entries (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id              UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    queue_id            UUID NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
    task_name           TEXT NOT NULL,
    payload_snapshot    JSONB NOT NULL,
    attempt_count       INTEGER NOT NULL,
    final_error         TEXT,
    original_created_at TIMESTAMPTZ NOT NULL,
    moved_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    requeued_at         TIMESTAMPTZ,
    requeued_by         UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_dlq_queue ON dead_letter_entries(queue_id, moved_at DESC);
CREATE UNIQUE INDEX uq_dlq_job ON dead_letter_entries(job_id);

-- ----------------------------------------------------------------------------
-- updated_at triggers
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_projects_updated_at BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_queues_updated_at BEFORE UPDATE ON queues
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_jobs_updated_at BEFORE UPDATE ON jobs
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
