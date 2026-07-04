import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Sparkles, XCircle } from 'lucide-react';
import { getJobDetail, cancelJob, getFailureSummary } from '../api/client';
import { PageHeader, Panel } from '../components/Panel';
import { StatusBadge } from '../components/StatusBadge';
import { relativeTime, shortId, formatMs } from '../utils/format';
import { useLiveEvents } from '../hooks/useLiveEvents';

export function JobDetail() {
  const { projectId, jobId } = useParams<{ projectId: string; jobId: string }>();
  const queryClient = useQueryClient();
  useLiveEvents(projectId ?? null);
  const [summary, setSummary] = useState<any>(null);

  const detail = useQuery({
    queryKey: ['jobDetail', jobId],
    queryFn: () => getJobDetail(jobId!),
    refetchInterval: 4000,
  });

  const cancel = useMutation({
    mutationFn: () => cancelJob(jobId!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['jobDetail', jobId] }),
  });

  const fetchSummary = useMutation({
    mutationFn: () => getFailureSummary(jobId!),
    onSuccess: (data) => setSummary(data),
  });

  if (!detail.data) return <div className="p-8 text-ink-500">Loading…</div>;
  const { job, executions, logs, dependencies } = detail.data;
  const cancellable = ['queued', 'scheduled', 'waiting_deps', 'claimed'].includes(job.status);

  return (
    <div className="mx-auto max-w-4xl px-8 py-8">
      <Link to={`/p/${projectId}/jobs`} className="mb-4 inline-flex items-center gap-1 text-xs text-ink-500 hover:text-ink-300">
        <ArrowLeft className="h-3 w-3" /> Job explorer
      </Link>

      <PageHeader
        title={job.task_name}
        subtitle={`Job ${job.id}`}
        action={
          <div className="flex items-center gap-2">
            <StatusBadge status={job.status} />
            {cancellable && (
              <button onClick={() => cancel.mutate()}
                className="flex items-center gap-1.5 rounded-md border border-base-700 px-3 py-2 text-xs text-signal-failed hover:bg-signal-failed/10">
                <XCircle className="h-3.5 w-3.5" /> Cancel
              </button>
            )}
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-4 gap-4 text-sm">
        <Info label="Job type" value={job.job_type} />
        <Info label="Attempts" value={`${job.attempt_count}`} />
        <Info label="Priority" value={`${job.priority}`} />
        <Info label="Run at" value={relativeTime(job.run_at)} />
      </div>

      {job.last_error && (
        <Panel className="mb-6 border-signal-failed/30" title="Last error">
          <p className="mb-3 font-mono text-xs text-signal-failed">{job.last_error}</p>
          <button
            onClick={() => fetchSummary.mutate()}
            className="flex items-center gap-1.5 rounded-md border border-base-700 px-3 py-1.5 text-xs text-ink-300 hover:text-ink-100"
          >
            <Sparkles className="h-3.5 w-3.5" /> Summarize failure pattern
          </button>
          {summary && (
            <div className="mt-3 space-y-1 rounded-md bg-base-850 p-3 text-xs">
              <p><span className="text-ink-500">Summary: </span>{summary.summary}</p>
              <p><span className="text-ink-500">Likely cause: </span>{summary.likelyCause}</p>
              <p><span className="text-ink-500">Suggestion: </span>{summary.suggestion}</p>
            </div>
          )}
        </Panel>
      )}

      <Panel title="Payload" className="mb-6">
        <pre className="overflow-x-auto rounded-md bg-base-850 p-3 font-mono text-xs text-ink-300">
          {JSON.stringify(job.payload, null, 2)}
        </pre>
      </Panel>

      {dependencies.length > 0 && (
        <Panel title="Dependencies" className="mb-6">
          <ul className="space-y-1 text-xs">
            {dependencies.map((d: any) => (
              <li key={d.depends_on_job_id} className="flex items-center justify-between">
                <span className="font-mono text-ink-300">{shortId(d.depends_on_job_id)}</span>
                <StatusBadge status={d.status} />
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title="Execution history / retry attempts" className="mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-base-700 text-left text-xs uppercase tracking-wide text-ink-500">
              <th className="pb-2">Attempt</th>
              <th className="pb-2">Worker</th>
              <th className="pb-2">Status</th>
              <th className="pb-2">Duration</th>
              <th className="pb-2">Started</th>
            </tr>
          </thead>
          <tbody>
            {executions.map((ex: any) => (
              <tr key={ex.id} className="border-b border-base-800 last:border-0">
                <td className="py-2 font-mono text-ink-300">#{ex.attempt_number}</td>
                <td className="py-2 font-mono text-ink-500">{ex.worker_id ? shortId(ex.worker_id) : '—'}</td>
                <td className="py-2"><StatusBadge status={ex.status === 'succeeded' ? 'completed' : ex.status} /></td>
                <td className="py-2 font-mono text-ink-300">{formatMs(ex.duration_ms)}</td>
                <td className="py-2 text-ink-500">{relativeTime(ex.started_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel title="Logs">
        <div className="max-h-64 space-y-1 overflow-y-auto font-mono text-xs">
          {logs.map((l: any) => (
            <div key={l.id} className="flex gap-2">
              <span className="text-ink-700">{new Date(l.created_at).toLocaleTimeString()}</span>
              <span className={l.level === 'error' ? 'text-signal-failed' : l.level === 'warn' ? 'text-signal-queued' : 'text-ink-300'}>
                [{l.level}]
              </span>
              <span className="text-ink-300">{l.message}</span>
            </div>
          ))}
          {logs.length === 0 && <p className="text-ink-500">No logs recorded yet.</p>}
        </div>
      </Panel>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-base-700 bg-base-850 px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-ink-500">{label}</div>
      <div className="mt-1 font-mono text-sm text-ink-100">{value}</div>
    </div>
  );
}
