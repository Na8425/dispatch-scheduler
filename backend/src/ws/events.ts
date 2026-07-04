import { redis } from '../config/redis';

/**
 * Publishes a domain event for a project. The worker process (which has no
 * direct connection to any dashboard client) and the API process both call
 * this; the API process's socket gateway subscribes to Redis and fans the
 * event out to connected WebSocket clients in that project's room.
 *
 * Routing job execution through Redis pub/sub (rather than the API process
 * holding a direct reference to the worker) is what makes this
 * "event-driven": any number of API instances behind a load balancer will
 * all receive the event and forward it to their own connected clients,
 * which a simple in-process EventEmitter could not do.
 */
export function publishEvent(projectId: string, event: string, payload: unknown): void {
  redis
    .publish(`events:${projectId}`, JSON.stringify({ event, payload, ts: new Date().toISOString() }))
    .catch(() => {
      // Best-effort: live updates are a UX enhancement, not correctness-critical.
      // A missed pub/sub message never causes stale DB state — the dashboard
      // will pick up the change on its next poll.
    });
}
