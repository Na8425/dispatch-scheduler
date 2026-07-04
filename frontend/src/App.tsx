import { Navigate, Route, Routes } from 'react-router-dom';
import { Login } from './pages/Login';
import { Layout } from './components/Layout';
import { Overview } from './pages/Overview';
import { Queues } from './pages/Queues';
import { QueueDetail } from './pages/QueueDetail';
import { Jobs } from './pages/Jobs';
import { JobDetail } from './pages/JobDetail';
import { Workers } from './pages/Workers';
import { DeadLetter } from './pages/DeadLetter';
import { useAuth } from './hooks/useAuth';

function RequireAuth({ children }: { children: JSX.Element }) {
  const { token } = useAuth();
  if (!token) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/p/:projectId"
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Overview />} />
        <Route path="queues" element={<Queues />} />
        <Route path="queues/:queueId" element={<QueueDetail />} />
        <Route path="jobs" element={<Jobs />} />
        <Route path="jobs/:jobId" element={<JobDetail />} />
        <Route path="workers" element={<Workers />} />
        <Route path="dead-letter" element={<DeadLetter />} />
      </Route>
      <Route path="/no-projects" element={<NoProjects />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

function NoProjects() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-base-950 text-ink-100">
      <p className="text-sm text-ink-500">
        Your organization has no projects yet. Create one via the API, then refresh.
      </p>
    </div>
  );
}
