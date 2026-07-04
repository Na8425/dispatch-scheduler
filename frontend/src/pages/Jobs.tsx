import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { listQueues, listJobs } from '../api/client';
import { PageHeader, Panel } from '../components/Panel';
import { StatusBadge } from '../components/StatusBadge';
import { relativeTime, shortId } from '../utils/format';
import { useLiveEvents } from '../hooks/useLiveEvents';

const STATUSES = ['', 'queued', 'scheduled', 'waiting_deps', 'claimed', 'running', 'completed', 'failed', 'dead_letter', 'cancelled'];

export function Jobs() {
  const { projectId } = useParams<{ projectId: string }>();
  useLiveEvents(projectId ?? null);
  const [queueId, setQueueId] = useState<string>('');
  const [status, setStatus] = useState('');
  const [taskName, setTaskName] = useState('');
  const [page, setPage] = useState(1);

  const queues = useQuery({ queryKey: ['queues', projectId], queryFn: () => listQueues(projectId!) });

  useEffect(() => {
    if (!queueId && queues.data?.[0]) setQueueId(queues.data[0].id);
  }, [queues.data, queueId]);

  const jobs = useQuery({
    queryKey: ['jobs', queueId, status, taskName, page],
    queryFn: () => listJobs(queueId, { status: status || undefined, taskName: taskName || undefined, page, pageSize: 15 }),
    enabled: !!queueId,
    refetchInterval: 4000,
  });

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <PageHeader title="Job Explorer" subtitle="Inspect, filter, and drill into individual jobs" />

      <Panel className="mb-6">
        <div className="grid grid-cols-4 gap-4">
          <label className="block">
            <span className="mb-1 block text-xs text-ink-500">Queue</span>
            <select value={queueId} onChange={(e) => { setQueueId(e.target.value); setPage(1); }}
              className="w-full rounded-md border border-base-700 bg-base-850 px-3 py-2 text-sm outline-none focus:border-signal-scheduled">
              {(queues.data ?? []).map((q: any) => <option key={q.id} value={q.id}>{q.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-ink-500">Status</span>
            <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}
              className="w-full rounded-md border border-base-700 bg-base-850 px-3 py-2 text-sm outline-none focus:border-signal-scheduled">
              {STATUSES.map((s) => <option key={s} value={s}>{s || 'All statuses'}</option>)}
            </select>
          </label>
          <label className="col-span-2 block">
            <span className="mb-1 block text-xs text-ink-500">Task name</span>
            <input value={taskName} onChange={(e) => { setTaskName(e.target.value); setPage(1); }} placeholder="e.g. send_email"
              className="w-full rounded-md border border-base-700 bg-base-850 px-3 py-2 text-sm outline-none focus:border-signal-scheduled" />
          </label>
        </div>
      </Panel>

      <Panel>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-base-700 text-left text-xs uppercase tracking-wide text-ink-500">
              <th className="pb-2">Job</th>
              <th className="pb-2">Task</th>
              <th className="pb-2">Status</th>
              <th className="pb-2">Attempts</th>
              <th className="pb-2">Priority</th>
              <th className="pb-2">Updated</th>
            </tr>
          </thead>
          <tbody>
            {(jobs.data?.data ?? []).map((j: any) => (
              <tr key={j.id} className="border-b border-base-800 last:border-0 hover:bg-base-850">
                <td className="py-2.5">
                  <Link to={`/p/${projectId}/jobs/${j.id}`} className="font-mono text-signal-scheduled hover:underline">
                    {shortId(j.id)}
                  </Link>
                </td>
                <td className="py-2.5 font-mono text-ink-300">{j.task_name}</td>
                <td className="py-2.5"><StatusBadge status={j.status} /></td>
                <td className="py-2.5 font-mono text-ink-300">{j.attempt_count}</td>
                <td className="py-2.5 font-mono text-ink-300">{j.priority}</td>
                <td className="py-2.5 text-ink-500">{relativeTime(j.updated_at)}</td>
              </tr>
            ))}
            {jobs.data?.data?.length === 0 && (
              <tr><td colSpan={6} className="py-8 text-center text-ink-500">No jobs match these filters.</td></tr>
            )}
          </tbody>
        </table>

        {jobs.data?.meta && (
          <div className="mt-4 flex items-center justify-between text-xs text-ink-500">
            <span>{jobs.data.meta.total} total jobs</span>
            <div className="flex items-center gap-2">
              <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
                className="rounded border border-base-700 px-2 py-1 disabled:opacity-30">Prev</button>
              <span>Page {jobs.data.meta.page} / {jobs.data.meta.totalPages}</span>
              <button disabled={page >= jobs.data.meta.totalPages} onClick={() => setPage((p) => p + 1)}
                className="rounded border border-base-700 px-2 py-1 disabled:opacity-30">Next</button>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
