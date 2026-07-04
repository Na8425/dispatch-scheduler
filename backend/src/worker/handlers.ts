/**
 * Job handler registry. In a real deployment, this file (or an equivalent
 * plugin-loading mechanism) is the integration point where application
 * teams register the actual work their jobs perform. The handlers below
 * are intentionally simple/simulated so the scheduler can be demoed and
 * tested end-to-end without external dependencies (a real SMTP server,
 * a real HTTP target, etc).
 *
 * Contract: a handler receives the job's payload and must either resolve
 * with a JSON-serializable result (job succeeds) or throw/reject (job
 * fails and enters the retry/DLQ flow).
 */

export type JobHandler = (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const handlers: Record<string, JobHandler> = {
  noop: async (payload) => {
    return { ok: true, echoedPayload: payload };
  },

  sleep: async (payload) => {
    const ms = typeof payload.ms === 'number' ? payload.ms : 1000;
    await sleep(ms);
    return { ok: true, sleptMs: ms };
  },

  send_email: async (payload) => {
    await sleep(150);
    if (!payload.to) throw new Error('Validation error: "to" address is required');
    return { ok: true, sentTo: payload.to, subject: payload.subject ?? '(no subject)' };
  },

  http_request: async (payload) => {
    await sleep(200);
    if (!payload.url) throw new Error('Validation error: "url" is required');
    // Simulated response — a real implementation would use fetch() here.
    return { ok: true, url: payload.url, simulatedStatus: 200 };
  },

  /** Fails a configurable fraction of the time — useful for demoing retries/backoff/DLQ. */
  flaky_task: async (payload) => {
    await sleep(100);
    const failureRate = typeof payload.failureRate === 'number' ? payload.failureRate : 0.5;
    if (Math.random() < failureRate) {
      throw new Error('Simulated transient failure from flaky_task');
    }
    return { ok: true };
  },
};

export function resolveHandler(taskName: string): JobHandler {
  const handler = handlers[taskName];
  if (!handler) {
    throw new Error(`No handler registered for task "${taskName}"`);
  }
  return handler;
}
