import { NavLink, Outlet, useParams } from 'react-router-dom';
import { LayoutGrid, ListTree, Workflow, Users, Skull, LogOut, Radio } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

const navItems = [
  { to: '', label: 'Overview', icon: LayoutGrid, end: true },
  { to: 'queues', label: 'Queues', icon: ListTree },
  { to: 'jobs', label: 'Job Explorer', icon: Workflow },
  { to: 'workers', label: 'Workers', icon: Users },
  { to: 'dead-letter', label: 'Dead Letter', icon: Skull },
];

export function Layout() {
  const { logout } = useAuth();
  const { projectId } = useParams();

  return (
    <div className="flex min-h-screen bg-base-950 text-ink-100 font-display">
      <aside className="flex w-60 flex-col border-r border-base-700 bg-base-900">
        <div className="flex items-center gap-2 border-b border-base-700 px-5 py-5">
          <Radio className="h-5 w-5 text-signal-running" strokeWidth={2} />
          <div>
            <div className="font-mono text-sm font-semibold tracking-tight">DISPATCH</div>
            <div className="text-[11px] text-ink-500">Job Scheduler Console</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={`/p/${projectId}/${to}`}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? 'bg-base-800 text-ink-100'
                    : 'text-ink-300 hover:bg-base-850 hover:text-ink-100'
                }`
              }
            >
              <Icon className="h-4 w-4" strokeWidth={1.75} />
              {label}
            </NavLink>
          ))}
        </nav>
        <button
          onClick={logout}
          className="flex items-center gap-3 border-t border-base-700 px-6 py-4 text-sm text-ink-500 hover:text-ink-100"
        >
          <LogOut className="h-4 w-4" strokeWidth={1.75} />
          Sign out
        </button>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
