# API Reference

Base URL: `/api/v1`. All authenticated endpoints expect `Authorization: Bearer <jwt>`.

## Conventions

**Envelope.** List endpoints return `{ data: [...], meta: { page, pageSize, total, totalPages } }`.
Single-resource endpoints return `{ data: {...} }`. Errors return:
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": { } } }
```

**Error codes:** `VALIDATION_ERROR` (422), `UNAUTHORIZED` (401), `FORBIDDEN` (403),
`NOT_FOUND` (404), `CONFLICT` (409), `INVALID_REFERENCE` (422), `RATE_LIMITED` (429),
`INTERNAL_ERROR` (500). Postgres constraint violations (unique/foreign-key/not-null/bad
enum literal) are translated into the appropriate one of these rather than leaking as a
raw 500 — see `backend/src/middleware/errorHandler.ts`.

**Pagination:** `?page=1&pageSize=20` (`pageSize` capped at 100).

**Rate limiting:** applied per authenticated user (or per IP if unauthenticated) on
write-heavy endpoints (register, login, job creation). Responses include
`X-RateLimit-Limit` / `X-RateLimit-Remaining` headers.

---

## Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | none | Creates a user + their first organization (as owner). Returns a JWT. |
| POST | `/auth/login` | none | Returns a JWT. |
| GET | `/auth/me/organizations` | JWT | Organizations the current user belongs to, with role. |

```bash
curl -X POST /api/v1/auth/register -H 'Content-Type: application/json' -d '{
  "email": "you@example.com", "password": "at-least-8-chars",
  "name": "Your Name", "organizationName": "Acme Inc"
}'
```

## Projects

| Method | Path | Role required | Description |
|---|---|---|---|
| POST | `/organizations/:orgId/projects` | admin+ | Creates a project. Returns the plaintext API key **once** — store it. |
| GET | `/organizations/:orgId/projects` | viewer+ | List projects in an org. |
| GET | `/projects/:projectId` | viewer+ | Project detail. |

## Queues

| Method | Path | Role | Description |
|---|---|---|---|
| POST | `/projects/:projectId/queues` | admin+ | `{ name, priority?, maxConcurrency?, retryPolicyId?, rateLimitPerSec? }` |
| GET | `/projects/:projectId/queues` | viewer+ | List queues. |
| GET | `/queues/:queueId` | auth | Queue detail. |
| PATCH | `/queues/:queueId` | auth | Partial update of any config field above. |
| POST | `/queues/:queueId/pause` | auth | Stops new claims; in-flight jobs finish normally. |
| POST | `/queues/:queueId/resume` | auth | Re-enables claiming. |
| GET | `/queues/:queueId/stats` | auth | `{ byStatus, completedLastHour, deadLetteredLastHour, avgDurationMsLastHour }` |

## Retry policies

| Method | Path | Description |
|---|---|---|
| POST | `/projects/:projectId/retry-policies` | `{ name, strategy: fixed\|linear\|exponential, baseDelayMs?, multiplier?, maxDelayMs?, maxAttempts?, jitter? }` |
| GET | `/projects/:projectId/retry-policies` | List. |

## Jobs

| Method | Path | Description |
|---|---|---|
| POST | `/queues/:queueId/jobs` | Create a job (see shapes below). |
| POST | `/queues/:queueId/jobs/batch` | `{ jobs: [ {...}, {...} ] }` — up to 1000, share one `batchId`. |
| GET | `/queues/:queueId/jobs?status=&taskName=&page=&pageSize=` | Filtered, paginated list. |
| GET | `/jobs/:jobId` | Full detail: job row + execution history + logs + dependencies. |
| POST | `/jobs/:jobId/cancel` | Only valid while `queued`/`scheduled`/`waiting_deps`/`claimed`. |
| GET | `/jobs/:jobId/failure-summary` | Pattern-based classification of why a job keeps failing. |
| GET | `/batches/:batchId` | Aggregate status across a batch. |

**Job creation shapes** (all fields besides `taskName` optional):

```jsonc
// Immediate — runs as soon as a worker is free
{ "taskName": "send_email", "payload": { "to": "a@b.com" } }

// Delayed — runs after a relative delay
{ "taskName": "send_email", "delayMs": 60000 }

// Scheduled — runs at an absolute time
{ "taskName": "send_email", "runAt": "2026-08-01T09:00:00Z" }

// With a specific retry policy and an idempotency key
{ "taskName": "charge_card", "idempotencyKey": "invoice-4471",
  "retryPolicyId": "..." }

// Workflow dependency — waits until listed jobs are all `completed`
{ "taskName": "send_receipt", "dependsOnJobIds": ["<job-id-1>", "<job-id-2>"] }
```

Recurring jobs are created differently — see Scheduled (cron) jobs below; a cron
definition is a standing template that spawns a fresh `jobs` row on every firing.

## Scheduled (cron) jobs

| Method | Path | Description |
|---|---|---|
| POST | `/queues/:queueId/scheduled-jobs` | `{ name, taskName, cronExpression, payloadTemplate?, timezone?, priority?, retryPolicyId? }` |
| GET | `/queues/:queueId/scheduled-jobs` | List definitions with `next_run_at`/`last_run_at`. |
| POST | `/scheduled-jobs/:id/pause` | Stops future firings. |
| POST | `/scheduled-jobs/:id/resume` | Resumes; recomputes `next_run_at`. |

## Workers

| Method | Path | Description |
|---|---|---|
| GET | `/projects/:projectId/workers` | List, including a computed `is_stale` flag. |
| GET | `/workers/:workerId` | Detail. |
| GET | `/workers/:workerId/heartbeats` | Recent heartbeat time series (for the sparkline). |

## Dead Letter Queue

| Method | Path | Description |
|---|---|---|
| GET | `/queues/:queueId/dead-letter?page=&pageSize=` | Paginated permanently-failed jobs. |
| POST | `/dead-letter/:entryId/requeue` | Resets the original job to `queued`, attempt count to 0. |

## Metrics

| Method | Path | Description |
|---|---|---|
| GET | `/projects/:projectId/metrics/throughput?minutes=60` | Per-minute completed/failed counts. |
| GET | `/projects/:projectId/metrics/health` | Job counts by status, worker counts by status, unresolved DLQ count. |

## WebSocket (live updates)

Connect to the same origin with `path: '/socket.io'`, auth via `{ auth: { token: jwt } }`.

```js
const socket = io('/', { auth: { token }, path: '/socket.io' });
socket.emit('subscribe:project', projectId);
socket.on('event', ({ event, payload, ts }) => { /* job.created, job.claimed,
  job.completed, job.retry_scheduled, job.dead_lettered, job.promoted,
  job.requeued, batch.created */ });
```
