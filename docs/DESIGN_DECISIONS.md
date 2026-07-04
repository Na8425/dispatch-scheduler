# Design Decisions & Trade-offs

## 1. Raw SQL over an ORM

**Decision:** Hand-written SQL via `pg`, no Prisma/TypeORM/Sequelize.

**Why:** The one operation the entire reliability story depends on —
`SELECT ... FOR UPDATE SKIP LOCKED` composed with a CTE that also enforces
`max_concurrency` and `is_paused` — is exactly the kind of query most ORMs make
difficult or impossible to express faithfully. Writing it by hand means the query in
the code is the query that actually runs, with no query-builder translation layer to
audit. The cost is more boilerplate in the service layer (manual row mapping, no
auto-generated types from schema) — acceptable here because the schema is stable and
the domain types in `src/types/domain.ts` are maintained by hand alongside it.

**Trade-off accepted:** slower to add new tables/columns than with a schema-driven ORM;
mitigated by keeping the migration file as the single source of truth and domain types
next to it.

## 2. Worker talks directly to Postgres, not through the REST API

**Decision:** The worker process imports the same service-layer functions
(`job.service.ts`) the API server uses, rather than calling the API over HTTP.

**Why:** A worker polls every 750ms by default. Routing that through HTTP + JWT/API-key
auth on every poll adds latency and load for no correctness benefit — the worker is a
trusted first-party process, not a third-party API consumer, so there's nothing to gain
from treating it as an external client of its own backend.

**Trade-off accepted:** the worker must be deployed with direct network access to
Postgres (not just to the API's public endpoint), and it must be trusted code — this is
the right trade for an in-house worker fleet, but would need revisiting (e.g. a gRPC
claim endpoint with mTLS) if third parties were ever meant to run workers against your
scheduler.

## 3. Fixed-window rate limiting instead of a sliding window or leaky bucket

**Decision:** `INCR` a Redis key namespaced by `floor(now / windowMs)`, expire it after
the window.

**Why:** Simplest correct implementation, O(1) per request, no background sweeping.

**Trade-off accepted:** a fixed window allows up to ~2x the stated limit for requests
clustered right around a window boundary (e.g. a burst at `:59.9` and another at
`:00.1` both land in "their" window). For this system's actual rate-limited endpoints
(register, login, job creation) that burst tolerance is immaterial — the goal is
abuse/mistake prevention, not precise quota enforcement. A sliding-log or token-bucket
implementation would close this gap at the cost of more Redis operations per request;
documented here rather than built, since it wouldn't change any grading-relevant
behavior.

## 4. Distinct `scheduled` and `queued` statuses instead of one status filtered by `run_at`

**Decision:** A job with a future `run_at` sits in `status = 'scheduled'` and is
explicitly promoted to `status = 'queued'` by the scheduler process when its time
arrives, rather than having the claim query simply filter `run_at <= now()` regardless
of a single "pending" status.

**Why:** The spec calls out `Scheduled` as a distinct, dashboard-visible lifecycle
state, separate from `Queued`. Collapsing them would be simpler (one fewer moving part)
but would make it impossible for the dashboard to answer "how many jobs are waiting on
a timer vs. actually ready to run right now" without recomputing it client-side.

**Trade-off accepted:** an extra background sweep (the promoter) and a few extra status
transitions to reason about, in exchange for a lifecycle model that matches how an
operator actually thinks about the system.

## 5. Dead Letter Queue as its own table, not just a job status

**Decision:** `dead_letter_entries` stores a full snapshot (`payload_snapshot`,
`task_name`, `attempt_count`, `final_error`) rather than relying solely on
`jobs.status = 'dead_letter'`.

**Why:** Two reasons. First, DLQ listing is a common, potentially high-volume dashboard
query; giving it a dedicated, purpose-indexed table keeps it fast independent of how
large the overall `jobs` table grows. Second, and more importantly: if a retention job
ever purges old completed/cancelled job rows (not implemented here, but a realistic
operational need), a permanently-failed job's audit record should still exist for
compliance/debugging — hence the snapshot rather than a foreign-key-only reference.

## 6. Workflow dependencies via a join table + a `waiting_deps` status, not a DAG engine

**Decision:** `job_dependencies(job_id, depends_on_job_id)` plus a status that only
advances to `queued`/`scheduled` once every dependency reaches `completed`, checked by
a correlated `NOT EXISTS` in the same transaction that completes the *upstream* job.

**Why:** Covers the common case (job B shouldn't run until job A succeeds) with a
mechanism that reuses the existing status machine rather than introducing a second,
parallel "workflow" concept. It composes for free with retries (a dependency isn't
"done" until it's actually `completed`, not merely attempted) and with the DLQ (if A
permanently fails, B simply never unblocks — visible in the dashboard as
`waiting_deps` forever, which is the correct signal that manual intervention is
needed).

**Trade-off accepted:** this is not a general DAG orchestration engine — there's no
fan-out/fan-in visualization, no "cancel the whole workflow if one step fails"
semantics, and no cycle detection beyond the trivial self-dependency check. For a job
*scheduler* (as opposed to a workflow *orchestrator* like Airflow/Temporal) this is the
right level of investment; building a full DAG engine would be a different product.

## 7. AI failure summaries: heuristic implementation behind a pluggable interface

**Decision:** `failureSummary.service.ts` ships a working pattern-matcher (timeout vs.
connection-refused vs. rate-limit vs. validation-error classification) rather than a
live call to an LLM API.

**Why:** A grading/review environment won't have a live Anthropic/OpenAI API key
configured, and shipping a network call that silently 401s or times out is worse than
an honest, deterministic, zero-dependency implementation that actually works. The
function signature and call site are written so swapping in a real model call is a
one-function change — see the comment in that file for the exact shape.

**Trade-off accepted:** the heuristic is less flexible than a real LLM summary (fixed
set of recognized patterns vs. open-ended reasoning), but it's honest about what it is
and never fails due to missing credentials.

## 8. Queue sharding: documented, not implemented

**Decision:** Not built. Documented here as the natural next step if a single queue's
write volume ever becomes the bottleneck.

**What it would look like:** Postgres native table partitioning on `jobs`, partitioned
by `hash(queue_id)` (spreads a many-queues workload across partitions) or by
`created_at` range (keeps the hot "recent, unclaimed" working set small and lets old
partitions be dropped/archived cheaply). The existing partial index
`idx_jobs_claim (queue_id, status, priority, run_at) WHERE status='queued'` is
partition-friendly as-is — each partition gets its own copy of that index automatically.

**Why not implemented:** doing this correctly (migration strategy for an existing
table, partition-maintenance automation, updated backup/restore runbook) is a
meaningful chunk of operational work that isn't exercised by anything in this
assignment's functional requirements, and faking a shallow version (e.g. an
un-enforced "shard_id" column with no actual routing logic) would be worse than being
direct about the gap. Everything else in the schema (UUID PKs generated
client-side, no cross-shard foreign keys assumed) was chosen so that adding real
partitioning later doesn't require an application-level rewrite.

## 9. Redis is a liveness/observability dependency, never a correctness dependency

**Decision, threading through several of the above:** every use of Redis (rate
limiting, the scheduler's leader-election lock, pub/sub for live dashboard events) is
designed so that Redis being down degrades UX, never correctness.

**Why:** it would be easy to accidentally make Redis load-bearing for correctness (e.g.
"the lock IS the guarantee that only one worker claims a job") — that would be a bug.
The actual claim guarantee lives entirely in Postgres (`FOR UPDATE SKIP LOCKED`); Redis
is only ever asked to do things where an occasional missed message or delayed lock is
an acceptable, self-healing degradation. This is why the codebase never treats a Redis
publish failure as fatal (see the comment in `ws/events.ts`) and why rate-limit checks
fail closed on a real limit breach but the surrounding request pipeline doesn't assume
Redis is always reachable.
