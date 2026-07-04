import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Pause, Play } from 'lucide-react';
import {
  getQueue,
  updateQueue,
  pauseQueue,
  resumeQueue,
  getQueueStats,
  listRetryPolicies,
  createRetryPolicy,
  listJobs,
  createJob,
  listScheduledJobs,
  createScheduledJob,
} from '../api/client';
import { PageHeader, Panel, StatTile } from '../components/Panel';
import { StatusBadge } from '../components/StatusBadge';
import { relativeTime, shortId } from '../utils/format';
import { useLiveEvents } from '../hooks/useLiveEvents';

export function QueueDetail() {
  const { projectId, queueId } = useParams<{ projectId: string; queueId: string }>();
  const queryClient = useQueryClient();
  useLiveEvents(projectId ?? null);

  const queue = useQuery({ queryKey: ['queue', queueId], queryFn: () => getQueue(queueId!) });
  const stats = useQuery({
    queryKey: ['queueStats', queueId],
    queryFn: () => getQueueStats(queueId!),
    refetchInterval: 4000,
  });
  const retryPolicies = useQuery({
    queryKey: ['retryPolicies', projectId],
    queryFn: () => listRetryPolicies(projectId!),
  });
  const jobs = useQuery({
    queryKey: ['jobs', queueId],
    queryFn: () => listJobs(queueId!, { pageSize: 10 }),
    refetchInterval: 4000,
  });
  const scheduledJobs = useQuery({
    queryKey: ['scheduledJobs', queueId],
    queryFn: () => listScheduledJobs(queueId!),
  });

  const toggle = useMutation({
    mutationFn: (paused: boolean) => (paused ? resumeQueue(queueId!) : pauseQueue(queueId!)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['queue', queueId] }),
  });

  const updateConfig = useMutation({
    mutationFn: (body: Record<string, unknown>) => updateQueue(queueId!, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['queue', queueId] }),
  });

  if (!queue.data) return <div className="p-8 text-ink-500">Loading…</div>;
  const q = queue.data;

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <Link to={`/p/${projectId}/queues`} className="mb-4 inline-flex items-center gap-1 text-xs text-ink-500 hover:text-ink-300">
        <ArrowLeft className="h-3 w-3" /> All queues
      </Link>
      <PageHeader
        title={q.name}
        subtitle={`Queue ID ${shortId(q.id)}`}
        action={
          <button
            onClick={() => toggle.mutate(q.is_paused)}
            className="flex items-center gap-1.5 rounded-md border border-base-700 px-3 py-2 text-sm text-ink-300 hover:text-ink-100"
          >
            {q.is_paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            {q.is_paused ? 'Resume queue' : 'Pause queue'}
          </button>
        }
      />

      <div className="mb-6 grid grid-cols-4 gap-4">
        <StatTile label="Completed / hr" value={stats.data?.completedLastHour ?? 0} tone="good" />
        <StatTile label="Dead-lettered / hr" value={stats.data?.deadLetteredLastHour ?? 0} tone={stats.data?.deadLetteredLastHour ? 'danger' : 'default'} />
        <StatTile label="Avg duration" value={stats.data?.avgDurationMsLastHour ? `${stats.data.avgDurationMsLastHour}ms` : '—'} />
        <StatTile label="In flight" value={(stats.data?.byStatus?.claimed ?? 0) + (stats.data?.byStatus?.running ?? 0)} />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-6">
        <Panel title="Configuration">
          <ConfigForm queue={q} retryPolicies={retryPolicies.data ?? []} onSave={(body) => updateConfig.mutate(body)} />
        </Panel>
        <Panel title="Create retry policy">
          <RetryPolicyForm projectId={projectId!} onCreated={() => retryPolicies.refetch()} />
        </Panel>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-6">
        <Panel title="Submit a job">
          <SubmitJobForm queueId={queueId!} retryPolicies={retryPolicies.data ?? []} onCreated={() => jobs.refetch()} />
        </Panel>
        <Panel title="Recurring (cron) jobs">
          <ScheduledJobsPanel
            queueId={queueId!}
            defs={scheduledJobs.data ?? []}
            onCreated={() => scheduledJobs.refetch()}
          />
        </Panel>
      </div>

      <Panel title="Recent jobs in this queue">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-base-700 text-left text-xs uppercase tracking-wide text-ink-500">
              <th className="pb-2">Task</th>
              <th className="pb-2">Status</th>
              <th className="pb-2">Attempts</th>
              <th className="pb-2">Updated</th>
              <th className="pb-2">Job</th>
            </tr>
          </thead>
          <tbody>
            {(jobs.data?.data ?? []).map((j: any) => (
              <tr key={j.id} className="border-b border-base-800 last:border-0">
                <td className="py-2.5 font-mono text-ink-300">{j.task_name}</td>
                <td className="py-2.5"><StatusBadge status={j.status} /></td>
                <td className="py-2.5 font-mono text-ink-300">{j.attempt_count}</td>
                <td className="py-2.5 text-ink-500">{relativeTime(j.updated_at)}</td>
                <td className="py-2.5">
                  <Link to={`/p/${projectId}/jobs/${j.id}`} className="text-signal-scheduled hover:underline">
                    {shortId(j.id)}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

function ConfigForm({ queue, retryPolicies, onSave }: { queue: any; retryPolicies: any[]; onSave: (b: Record<string, unknown>) => void }) {
  const [priority, setPriority] = useState(queue.priority);
  const [maxConcurrency, setMaxConcurrency] = useState(queue.max_concurrency);
  const [retryPolicyId, setRetryPolicyId] = useState(queue.default_retry_policy_id ?? '');

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ priority, maxConcurrency, retryPolicyId: retryPolicyId || null });
      }}
      className="space-y-3"
    >
      <label className="block">
        <span className="mb-1 block text-xs text-ink-500">Priority</span>
        <input type="number" value={priority} onChange={(e) => setPriority(parseInt(e.target.value, 10))}
          className="w-full rounded-md border border-base-700 bg-base-850 px-3 py-2 text-sm outline-none focus:border-signal-scheduled" />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs text-ink-500">Max concurrency</span>
        <input type="number" min={1} value={maxConcurrency} onChange={(e) => setMaxConcurrency(parseInt(e.target.value, 10))}
          className="w-full rounded-md border border-base-700 bg-base-850 px-3 py-2 text-sm outline-none focus:border-signal-scheduled" />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs text-ink-500">Default retry policy</span>
        <select value={retryPolicyId} onChange={(e) => setRetryPolicyId(e.target.value)}
          className="w-full rounded-md border border-base-700 bg-base-850 px-3 py-2 text-sm outline-none focus:border-signal-scheduled">
          <option value="">None (use platform default)</option>
          {retryPolicies.map((p) => (
            <option key={p.id} value={p.id}>{p.name} ({p.strategy})</option>
          ))}
        </select>
      </label>
      <button type="submit" className="rounded-md bg-signal-scheduled/90 px-4 py-2 text-sm font-medium text-base-950 hover:bg-signal-scheduled">
        Save configuration
      </button>
    </form>
  );
}

function RetryPolicyForm({ projectId, onCreated }: { projectId: string; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [strategy, setStrategy] = useState('exponential');
  const [maxAttempts, setMaxAttempts] = useState(5);
  const [baseDelayMs, setBaseDelayMs] = useState(1000);

  const create = useMutation({
    mutationFn: () => createRetryPolicy(projectId, { name, strategy, maxAttempts, baseDelayMs }),
    onSuccess: () => { setName(''); onCreated(); },
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs text-ink-500">Policy name</span>
        <input required value={name} onChange={(e) => setName(e.target.value)}
          className="w-full rounded-md border border-base-700 bg-base-850 px-3 py-2 text-sm outline-none focus:border-signal-scheduled" />
      </label>
      <div className="grid grid-cols-3 gap-3">
        <label className="block">
          <span className="mb-1 block text-xs text-ink-500">Strategy</span>
          <select value={strategy} onChange={(e) => setStrategy(e.target.value)}
            className="w-full rounded-md border border-base-700 bg-base-850 px-3 py-2 text-sm outline-none focus:border-signal-scheduled">
            <option value="fixed">Fixed</option>
            <option value="linear">Linear</option>
            <option value="exponential">Exponential</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-ink-500">Base delay (ms)</span>
          <input type="number" value={baseDelayMs} onChange={(e) => setBaseDelayMs(parseInt(e.target.value, 10))}
            className="w-full rounded-md border border-base-700 bg-base-850 px-3 py-2 text-sm outline-none focus:border-signal-scheduled" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-ink-500">Max attempts</span>
          <input type="number" min={1} value={maxAttempts} onChange={(e) => setMaxAttempts(parseInt(e.target.value, 10))}
            className="w-full rounded-md border border-base-700 bg-base-850 px-3 py-2 text-sm outline-none focus:border-signal-scheduled" />
        </label>
      </div>
      <button type="submit" className="rounded-md border border-base-700 px-4 py-2 text-sm text-ink-300 hover:text-ink-100">
        Add policy
      </button>
    </form>
  );
}

function SubmitJobForm({ queueId, retryPolicies, onCreated }: { queueId: string; retryPolicies: any[]; onCreated: () => void }) {
  const [taskName, setTaskName] = useState('noop');
  const [payload, setPayload] = useState('{}');
  const [timing, setTiming] = useState<'now' | 'delay'>('now');
  const [delayMs, setDelayMs] = useState(5000);
  const [retryPolicyId, setRetryPolicyId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => {
      let parsedPayload: Record<string, unknown>;
      try {
        parsedPayload = JSON.parse(payload || '{}');
      } catch {
        throw new Error('Payload must be valid JSON');
      }
      return createJob(queueId, {
        taskName,
        payload: parsedPayload,
        ...(timing === 'delay' ? { delayMs } : {}),
        retryPolicyId: retryPolicyId || undefined,
      });
    },
    onSuccess: () => onCreated(),
    onError: (err: any) => setError(err?.response?.data?.error?.message ?? err.message),
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); setError(null); create.mutate(); }} className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs text-ink-500">Task</span>
        <select value={taskName} onChange={(e) => setTaskName(e.target.value)}
          className="w-full rounded-md border border-base-700 bg-base-850 px-3 py-2 text-sm outline-none focus:border-signal-scheduled">
          <option value="noop">noop</option>
          <option value="send_email">send_email</option>
          <option value="http_request">http_request</option>
          <option value="flaky_task">flaky_task (demo retries)</option>
          <option value="sleep">sleep</option>
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-xs text-ink-500">Payload (JSON)</span>
        <textarea value={payload} onChange={(e) => setPayload(e.target.value)} rows={2}
          className="w-full rounded-md border border-base-700 bg-base-850 px-3 py-2 font-mono text-xs outline-none focus:border-signal-scheduled" />
      </label>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs text-ink-300">
          <input type="radio" checked={timing === 'now'} onChange={() => setTiming('now')} /> Run now
        </label>
        <label className="flex items-center gap-1.5 text-xs text-ink-300">
          <input type="radio" checked={timing === 'delay'} onChange={() => setTiming('delay')} /> Delay (ms)
        </label>
        {timing === 'delay' && (
          <input type="number" value={delayMs} onChange={(e) => setDelayMs(parseInt(e.target.value, 10))}
            className="w-28 rounded-md border border-base-700 bg-base-850 px-2 py-1 text-xs outline-none focus:border-signal-scheduled" />
        )}
      </div>
      <label className="block">
        <span className="mb-1 block text-xs text-ink-500">Retry policy</span>
        <select value={retryPolicyId} onChange={(e) => setRetryPolicyId(e.target.value)}
          className="w-full rounded-md border border-base-700 bg-base-850 px-3 py-2 text-sm outline-none focus:border-signal-scheduled">
          <option value="">Queue default</option>
          {retryPolicies.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      {error && <p className="text-xs text-signal-failed">{error}</p>}
      <button type="submit" className="rounded-md bg-signal-running/90 px-4 py-2 text-sm font-medium text-base-950 hover:bg-signal-running">
        Submit job
      </button>
    </form>
  );
}

function ScheduledJobsPanel({ queueId, defs, onCreated }: { queueId: string; defs: any[]; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [taskName, setTaskName] = useState('noop');
  const [cron, setCron] = useState('*/5 * * * *');

  const create = useMutation({
    mutationFn: () => createScheduledJob(queueId, { name, taskName, cronExpression: cron }),
    onSuccess: () => { setName(''); onCreated(); },
  });

  return (
    <div>
      <ul className="mb-4 space-y-2">
        {defs.map((d) => (
          <li key={d.id} className="flex items-center justify-between rounded-md border border-base-700 bg-base-850 px-3 py-2 text-xs">
            <div>
              <div className="font-medium text-ink-100">{d.name}</div>
              <div className="font-mono text-ink-500">{d.cron_expression} · {d.task_name}</div>
            </div>
            <span className="text-ink-500">next {relativeTime(d.next_run_at)}</span>
          </li>
        ))}
        {defs.length === 0 && <li className="text-xs text-ink-500">No recurring jobs defined yet.</li>}
      </ul>
      <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="space-y-2">
        <div className="grid grid-cols-3 gap-2">
          <input required placeholder="name" value={name} onChange={(e) => setName(e.target.value)}
            className="rounded-md border border-base-700 bg-base-850 px-2 py-1.5 text-xs outline-none focus:border-signal-scheduled" />
          <input placeholder="task_name" value={taskName} onChange={(e) => setTaskName(e.target.value)}
            className="rounded-md border border-base-700 bg-base-850 px-2 py-1.5 text-xs outline-none focus:border-signal-scheduled" />
          <input placeholder="* * * * *" value={cron} onChange={(e) => setCron(e.target.value)}
            className="rounded-md border border-base-700 bg-base-850 px-2 py-1.5 font-mono text-xs outline-none focus:border-signal-scheduled" />
        </div>
        <button type="submit" className="rounded-md border border-base-700 px-3 py-1.5 text-xs text-ink-300 hover:text-ink-100">
          Add recurring job
        </button>
      </form>
    </div>
  );
}
