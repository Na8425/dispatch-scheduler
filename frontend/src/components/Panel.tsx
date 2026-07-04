import { ReactNode } from 'react';

export function Panel({ title, action, children, className = '' }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-base-700 bg-base-900 shadow-panel ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between border-b border-base-700 px-5 py-3">
          {title && <h3 className="text-sm font-medium text-ink-300">{title}</h3>}
          {action}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex items-start justify-between">
      <div>
        <h1 className="text-xl font-semibold text-ink-100">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function StatTile({ label, value, tone = 'default' }: { label: string; value: string | number; tone?: 'default' | 'danger' | 'good' }) {
  const toneClass = tone === 'danger' ? 'text-signal-failed' : tone === 'good' ? 'text-signal-running' : 'text-ink-100';
  return (
    <div className="rounded-lg border border-base-700 bg-base-850 px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-ink-500">{label}</div>
      <div className={`mt-1 font-mono text-2xl font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}
