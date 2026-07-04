import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { getProjectHealth, getThroughput } from '../api/client';
import { PageHeader, Panel, StatTile } from '../components/Panel';
import { PulseStrip } from '../components/PulseStrip';
import { useLiveEvents } from '../hooks/useLiveEvents';

export function Overview() {
  const { projectId } = useParams<{ projectId: string }>();
  useLiveEvents(projectId ?? null);

  const health = useQuery({
    queryKey: ['projectHealth', projectId],
    queryFn: () => getProjectHealth(projectId!),
    refetchInterval: 5000,
  });

  const throughput = useQuery({
    queryKey: ['throughput', projectId],
    queryFn: () => getThroughput(projectId!, 60),
    refetchInterval: 5000,
  });

  const byStatus = health.data?.jobsByStatus ?? {};
  const activeCount = (byStatus.queued ?? 0) + (byStatus.claimed ?? 0) + (byStatus.running ?? 0);
  const points = (throughput.data ?? []).map((p: any) => ({ completed: p.completed, failed: p.failed }));

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <PageHeader title="Overview" subtitle="Live health and throughput for this project" />

      <Panel title="Throughput — last 60 minutes" className="mb-6">
        <PulseStrip points={points.length ? points : [{ completed: 0, failed: 0 }]} />
        <div className="mt-4 h-56">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={throughput.data ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#232A3D" vertical={false} />
              <XAxis
                dataKey="bucket"
                tickFormatter={(v) => new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                stroke="#525A72"
                fontSize={11}
              />
              <YAxis stroke="#525A72" fontSize={11} allowDecimals={false} />
              <Tooltip
                contentStyle={{ background: '#131826', border: '1px solid #232A3D', borderRadius: 8, fontSize: 12 }}
                labelFormatter={(v) => new Date(v).toLocaleTimeString()}
              />
              <Area type="monotone" dataKey="completed" stroke="#33C27F" fill="#33C27F22" strokeWidth={2} name="Completed" />
              <Area type="monotone" dataKey="failed" stroke="#E5546A" fill="#E5546A22" strokeWidth={2} name="Failed" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatTile label="Active jobs" value={activeCount} />
        <StatTile label="Completed" value={byStatus.completed ?? 0} tone="good" />
        <StatTile label="Retrying" value={byStatus.failed ?? 0} />
        <StatTile
          label="Unresolved dead letters"
          value={health.data?.unresolvedDeadLetterCount ?? 0}
          tone={health.data?.unresolvedDeadLetterCount ? 'danger' : 'default'}
        />
      </div>

      <div className="grid grid-cols-2 gap-6">
        <Panel title="Jobs by status">
          <ul className="space-y-2">
            {Object.entries(byStatus).map(([status, count]) => (
              <li key={status} className="flex items-center justify-between text-sm">
                <span className="capitalize text-ink-300">{status.replace('_', ' ')}</span>
                <span className="font-mono text-ink-100">{count as number}</span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Workers">
          <ul className="space-y-2">
            {Object.entries(health.data?.workersByStatus ?? {}).map(([status, count]) => (
              <li key={status} className="flex items-center justify-between text-sm">
                <span className="capitalize text-ink-300">{status}</span>
                <span className="font-mono text-ink-100">{count as number}</span>
              </li>
            ))}
            {Object.keys(health.data?.workersByStatus ?? {}).length === 0 && (
              <li className="text-sm text-ink-500">No workers have registered yet.</li>
            )}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
