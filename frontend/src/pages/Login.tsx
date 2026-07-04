import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Radio } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { listProjects } from '../api/client';

export function Login() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('demo@example.com');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [orgName, setOrgName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { login, register, organizationId } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        await register(email, password, name, orgName);
      }
      const orgId = localStorage.getItem('organizationId');
      const projects = orgId ? await listProjects(orgId) : [];
      if (projects[0]) {
        navigate(`/p/${projects[0].id}`);
      } else {
        navigate('/no-projects');
      }
    } catch (err: any) {
      setError(err?.response?.data?.error?.message ?? 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-base-950 font-display text-ink-100">
      <div className="w-full max-w-sm rounded-xl border border-base-700 bg-base-900 p-8 shadow-panel">
        <div className="mb-6 flex items-center gap-2">
          <Radio className="h-5 w-5 text-signal-running" />
          <span className="font-mono text-sm font-semibold tracking-tight">DISPATCH</span>
        </div>
        <h1 className="mb-1 text-lg font-semibold">
          {mode === 'login' ? 'Sign in to your console' : 'Create your console'}
        </h1>
        <p className="mb-6 text-sm text-ink-500">
          {mode === 'login' ? 'Manage queues, jobs, and workers.' : 'Sets up your organization and first project.'}
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          {mode === 'register' && (
            <>
              <Field label="Your name" value={name} onChange={setName} />
              <Field label="Organization name" value={orgName} onChange={setOrgName} />
            </>
          )}
          <Field label="Email" value={email} onChange={setEmail} type="email" />
          <Field label="Password" value={password} onChange={setPassword} type="password" />

          {error && <p className="text-sm text-signal-failed">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="mt-2 w-full rounded-md bg-signal-running/90 px-4 py-2 text-sm font-medium text-base-950 transition hover:bg-signal-running disabled:opacity-50"
          >
            {loading ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <button
          className="mt-4 w-full text-center text-xs text-ink-500 hover:text-ink-300"
          onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
        >
          {mode === 'login' ? "Need an account? Register" : 'Already have an account? Sign in'}
        </button>

        {mode === 'login' && (
          <p className="mt-6 border-t border-base-700 pt-4 text-[11px] text-ink-700">
            Demo credentials: demo@example.com / password123
          </p>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-500">{label}</span>
      <input
        required
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-base-700 bg-base-850 px-3 py-2 text-sm text-ink-100 outline-none focus:border-signal-scheduled"
      />
    </label>
  );
}
