import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { listQueues, listDeadLetter, requeueDeadLetter } from '../api/client';
import { PageHeader, Panel } from '../components/Panel';
import { relativeTime, shortId } from '../utils/format';
import { useLiveEvents } from '../hooks/useLiveEvents';

export function DeadLetter() {
  const { projectId } = useParams<{ projectId: string }>();
  useLiveEvents(projectId ?? null);
  const [queueId, setQueueId] = useState('');
  const queryClient = useQueryClient();

  const queues = useQuery({ queryKey: ['queues', projectId], queryFn: () => listQueues(projectId!) });
  useEffect(() => {
    if (!queueId && queues.data?.[0]) setQueueId(queues.data[0].id);
  }, [queues.data, queueId]);

  const entries = useQuery({
    queryKey: ['deadLetter', queueId],
    queryFn: () => listDeadLetter(queueId),
    enabled: !!queueId,
    refetchInterval: 5000,
  });

  const requeue = useMutation({
    mutationFn: (entryId: string) => requeueDeadLetter(entryId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['deadLetter', queueId] }),
  });

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <PageHeader
        title="Dead Letter Queue"
        subtitle="Jobs that exhausted their retry policy — inspect and requeue as needed"
        action={
          <select value={queueId} onChange={(e) => setQueueId(e.target.value)}
            className="rounded-md border border-base-700 bg-base-850 px-3 py-2 text-sm outline-none focus:border-signal-scheduled">
            {(queues.data ?? []).map((q: any) => <option key={q.id} value={q.id}>{q.name}</option>)}
          </select>
        }
      />

      <Panel>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-base-700 text-left text-xs uppercase tracking-wide text-ink-500">
              <th className="pb-2">Task</th>
              <th className="pb-2">Attempts</th>
              <th className="pb-2">Final error</th>
              <th className="pb-2">Moved</th>
              <th className="pb-2"></th>
            </tr>
          </thead>
          <tbody>
            {(entries.data?.data ?? []).map((e: any) => (
              <tr key={e.id} className="border-b border-base-800 last:border-0">
                <td className="py-2.5 font-mono text-ink-300">{e.task_name}</td>
                <td className="py-2.5 font-mono text-ink-300">{e.attempt_count}</td>
                <td className="max-w-xs truncate py-2.5 font-mono text-xs text-signal-failed" title={e.final_error}>
                  {e.final_error}
                </td>
                <td className="py-2.5 text-ink-500">{relativeTime(e.moved_at)}</td>
                <td className="py-2.5 text-right">
                  {e.requeued_at ? (
                    <span className="text-xs text-ink-500">requeued {relativeTime(e.requeued_at)}</span>
                  ) : (
                    <button
                      onClick={() => requeue.mutate(e.id)}
                      className="flex items-center gap-1.5 rounded-md border border-base-700 px-2.5 py-1.5 text-xs text-ink-300 hover:text-ink-100"
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Requeue
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {entries.data?.data?.length === 0 && (
              <tr><td colSpan={5} className="py-8 text-center text-ink-500">No dead-lettered jobs in this queue. 🎉</td></tr>
            )}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
