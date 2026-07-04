const STYLES: Record<string, { bg: string; dot: string; label: string }> = {
  queued: { bg: 'bg-signal-queued/10 text-signal-queued', dot: 'bg-signal-queued', label: 'Queued' },
  scheduled: { bg: 'bg-signal-scheduled/10 text-signal-scheduled', dot: 'bg-signal-scheduled', label: 'Scheduled' },
  waiting_deps: { bg: 'bg-signal-scheduled/10 text-signal-scheduled', dot: 'bg-signal-scheduled', label: 'Waiting on deps' },
  claimed: { bg: 'bg-signal-running/10 text-signal-running', dot: 'bg-signal-running', label: 'Claimed' },
  running: { bg: 'bg-signal-running/10 text-signal-running', dot: 'bg-signal-running', label: 'Running' },
  completed: { bg: 'bg-ink-500/10 text-ink-300', dot: 'bg-ink-500', label: 'Completed' },
  failed: { bg: 'bg-signal-failed/10 text-signal-failed', dot: 'bg-signal-failed', label: 'Failed — retrying' },
  dead_letter: { bg: 'bg-signal-dead/10 text-signal-dead', dot: 'bg-signal-dead', label: 'Dead letter' },
  cancelled: { bg: 'bg-ink-700/20 text-ink-500', dot: 'bg-ink-500', label: 'Cancelled' },
  online: { bg: 'bg-signal-running/10 text-signal-running', dot: 'bg-signal-running', label: 'Online' },
  draining: { bg: 'bg-signal-queued/10 text-signal-queued', dot: 'bg-signal-queued', label: 'Draining' },
  offline: { bg: 'bg-signal-idle/20 text-ink-500', dot: 'bg-ink-500', label: 'Offline' },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STYLES[status] ?? { bg: 'bg-ink-700/20 text-ink-300', dot: 'bg-ink-500', label: status };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${s.bg}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}
