import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts';
import { listWorkers, getWorkerHeartbeats } from '../api/client';
import { PageHeader, Panel } from '../components/Panel';
import { StatusBadge } from '../components/StatusBadge';
import { relativeTime, shortId } from '../utils/format';
import { useLiveEvents } from '../hooks/useLiveEvents';

export function Workers() {
  const { projectId } = useParams<{ projectId: string }>();
  useLiveEvents(projectId ?? null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const workers = useQuery({
    queryKey: ['workers', projectId],
    queryFn: () => listWorkers(projectId!),
    refetchInterval: 4000,
  });

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <PageHeader title="Workers" subtitle="Live worker fleet, heartbeats, and load" />

      <div className="space-y-3">
        {(workers.data ?? []).map((w: any) => (
          <Panel key={w.id} className="cursor-pointer" >
            <div className="flex items-center justify-between" onClick={() => setExpanded(expanded === w.id ? null : w.id)}>
              <div>
                <div className="font-mono text-sm text-ink-100">{w.hostname} <span className="text-ink-500">· {shortId(w.id)}</span></div>
                <div className="mt-1 text-xs text-ink-500">
                  Load {w.current_load}/{w.concurrency_capacity} · last heartbeat {relativeTime(w.last_heartbeat_at)}
                </div>
              </div>
              <div className="flex items-center gap-3">
                {w.is_stale && <span className="text-xs text-signal-failed">stale heartbeat</span>}
                <StatusBadge status={w.status} />
              </div>
            </div>
            {expanded === w.id && <HeartbeatChart workerId={w.id} />}
          </Panel>
        ))}
        {workers.data?.length === 0 && (
          <Panel><p className="text-sm text-ink-500">No workers have registered yet. Start one with <code className="font-mono text-ink-300">npm run dev:worker</code>.</p></Panel>
        )}
      </div>
    </div>
  );
}

function HeartbeatChart({ workerId }: { workerId: string }) {
  const heartbeats = useQuery({
    queryKey: ['heartbeats', workerId],
    queryFn: () => getWorkerHeartbeats(workerId),
    refetchInterval: 4000,
  });

  return (
    <div className="mt-4 h-24 border-t border-base-700 pt-3">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={heartbeats.data ?? []}>
          <YAxis hide domain={[0, 'dataMax + 1']} />
          <Line type="monotone" dataKey="active_job_count" stroke="#33C27F" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
