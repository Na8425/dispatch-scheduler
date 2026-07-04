import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, ChevronRight, Pause, Play } from 'lucide-react';
import { listQueues, createQueue, pauseQueue, resumeQueue } from '../api/client';
import { PageHeader, Panel } from '../components/Panel';

export function Queues() {
  const { projectId } = useParams<{ projectId: string }>();
  const [showForm, setShowForm] = useState(false);
  const queryClient = useQueryClient();

  const queues = useQuery({
    queryKey: ['queues', projectId],
    queryFn: () => listQueues(projectId!),
    refetchInterval: 5000,
  });

  const toggle = useMutation({
    mutationFn: ({ id, paused }: { id: string; paused: boolean }) =>
      paused ? resumeQueue(id) : pauseQueue(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['queues', projectId] }),
  });

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <PageHeader
        title="Queues"
        subtitle="Configure priority, concurrency, retry policy, and pause state per queue"
        action={
          <button
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-1.5 rounded-md bg-signal-scheduled/90 px-3 py-2 text-sm font-medium text-base-950 hover:bg-signal-scheduled"
          >
            <Plus className="h-4 w-4" /> New queue
          </button>
        }
      />

      {showForm && <CreateQueueForm projectId={projectId!} onDone={() => setShowForm(false)} />}

      <Panel className="mt-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-base-700 text-left text-xs uppercase tracking-wide text-ink-500">
              <th className="pb-2">Name</th>
              <th className="pb-2">Priority</th>
              <th className="pb-2">Max concurrency</th>
              <th className="pb-2">Status</th>
              <th className="pb-2"></th>
            </tr>
          </thead>
          <tbody>
            {(queues.data ?? []).map((q: any) => (
              <tr key={q.id} className="border-b border-base-800 last:border-0">
                <td className="py-3">
                  <Link to={`/p/${projectId}/queues/${q.id}`} className="font-medium text-ink-100 hover:text-signal-scheduled">
                    {q.name}
                  </Link>
                </td>
                <td className="py-3 font-mono text-ink-300">{q.priority}</td>
                <td className="py-3 font-mono text-ink-300">{q.max_concurrency}</td>
                <td className="py-3">
                  <span className={q.is_paused ? 'text-signal-queued' : 'text-signal-running'}>
                    {q.is_paused ? 'Paused' : 'Active'}
                  </span>
                </td>
                <td className="py-3 text-right">
                  <button
                    onClick={() => toggle.mutate({ id: q.id, paused: q.is_paused })}
                    className="mr-3 inline-flex items-center gap-1 rounded-md border border-base-700 px-2 py-1 text-xs text-ink-300 hover:text-ink-100"
                  >
                    {q.is_paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                    {q.is_paused ? 'Resume' : 'Pause'}
                  </button>
                  <Link to={`/p/${projectId}/queues/${q.id}`}>
                    <ChevronRight className="inline h-4 w-4 text-ink-500" />
                  </Link>
                </td>
              </tr>
            ))}
            {queues.data?.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-ink-500">
                  No queues yet — create one to start scheduling jobs.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

function CreateQueueForm({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const [name, setName] = useState('');
  const [priority, setPriority] = useState(0);
  const [maxConcurrency, setMaxConcurrency] = useState(5);
  const queryClient = useQueryClient();

  const create = useMutation({
    mutationFn: () => createQueue(projectId, { name, priority, maxConcurrency }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['queues', projectId] });
      onDone();
    },
  });

  return (
    <Panel className="mb-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
        className="grid grid-cols-4 items-end gap-4"
      >
        <label className="col-span-2 block">
          <span className="mb-1 block text-xs text-ink-500">Queue name</span>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-base-700 bg-base-850 px-3 py-2 text-sm outline-none focus:border-signal-scheduled"
            placeholder="e.g. email-notifications"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-ink-500">Priority</span>
          <input
            type="number"
            value={priority}
            onChange={(e) => setPriority(parseInt(e.target.value, 10))}
            className="w-full rounded-md border border-base-700 bg-base-850 px-3 py-2 text-sm outline-none focus:border-signal-scheduled"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-ink-500">Max concurrency</span>
          <input
            type="number"
            min={1}
            value={maxConcurrency}
            onChange={(e) => setMaxConcurrency(parseInt(e.target.value, 10))}
            className="w-full rounded-md border border-base-700 bg-base-850 px-3 py-2 text-sm outline-none focus:border-signal-scheduled"
          />
        </label>
        <button
          type="submit"
          className="col-span-4 mt-2 w-fit rounded-md bg-signal-running/90 px-4 py-2 text-sm font-medium text-base-950 hover:bg-signal-running"
        >
          Create queue
        </button>
      </form>
    </Panel>
  );
}
