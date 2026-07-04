interface PulsePoint {
  completed: number;
  failed: number;
}

/**
 * The dashboard's signature element. A dispatch console lives or dies by
 * whether you can tell "is throughput healthy right now" at a glance —
 * this renders recent completed/failed counts as a continuous waveform
 * (green fill for completions, a red spike overlay for failures) rather
 * than a bar chart, echoing a signal/telemetry strip instead of a generic
 * dashboard card.
 */
export function PulseStrip({ points }: { points: PulsePoint[] }) {
  const width = 800;
  const height = 64;
  const maxVal = Math.max(1, ...points.map((p) => p.completed + p.failed));
  const step = points.length > 1 ? width / (points.length - 1) : width;

  const linePath = (key: keyof PulsePoint) =>
    points
      .map((p, i) => {
        const x = i * step;
        const y = height - (p[key] / maxVal) * height;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

  const areaPath = (key: keyof PulsePoint) => `${linePath(key)} L${width},${height} L0,${height} Z`;

  return (
    <div className="w-full overflow-hidden rounded-lg border border-base-700 bg-base-900">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="none" height={height}>
        <path d={areaPath('completed')} fill="rgba(51,194,127,0.12)" />
        <path d={linePath('completed')} fill="none" stroke="#33C27F" strokeWidth={1.5} />
        <path d={linePath('failed')} fill="none" stroke="#E5546A" strokeWidth={1.5} strokeDasharray="3 2" />
      </svg>
    </div>
  );
}
