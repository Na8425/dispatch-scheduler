import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api/v1`
  : '/api/v1';

export const api = axios.create({ baseURL: BASE_URL });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  }
);

// ---- Auth ----
export const login = (email: string, password: string) =>
  api.post('/auth/login', { email, password }).then((r) => r.data);

export const register = (email: string, password: string, name: string, organizationName: string) =>
  api.post('/auth/register', { email, password, name, organizationName }).then((r) => r.data);

export const getMyOrganizations = () => api.get('/auth/me/organizations').then((r) => r.data.data);

// ---- Projects ----
export const listProjects = (orgId: string) =>
  api.get(`/organizations/${orgId}/projects`).then((r) => r.data.data);

export const createProject = (orgId: string, name: string) =>
  api.post(`/organizations/${orgId}/projects`, { name }).then((r) => r.data);

// ---- Queues ----
export const listQueues = (projectId: string) =>
  api.get(`/projects/${projectId}/queues`).then((r) => r.data.data);

export const createQueue = (projectId: string, body: Record<string, unknown>) =>
  api.post(`/projects/${projectId}/queues`, body).then((r) => r.data.data);

export const getQueue = (queueId: string) => api.get(`/queues/${queueId}`).then((r) => r.data.data);

export const updateQueue = (queueId: string, body: Record<string, unknown>) =>
  api.patch(`/queues/${queueId}`, body).then((r) => r.data.data);

export const pauseQueue = (queueId: string) => api.post(`/queues/${queueId}/pause`).then((r) => r.data.data);
export const resumeQueue = (queueId: string) => api.post(`/queues/${queueId}/resume`).then((r) => r.data.data);
export const getQueueStats = (queueId: string) => api.get(`/queues/${queueId}/stats`).then((r) => r.data.data);

// ---- Retry policies ----
export const listRetryPolicies = (projectId: string) =>
  api.get(`/projects/${projectId}/retry-policies`).then((r) => r.data.data);

export const createRetryPolicy = (projectId: string, body: Record<string, unknown>) =>
  api.post(`/projects/${projectId}/retry-policies`, body).then((r) => r.data.data);

// ---- Jobs ----
export const listJobs = (
  queueId: string,
  params: { status?: string; taskName?: string; page?: number; pageSize?: number }
) => api.get(`/queues/${queueId}/jobs`, { params }).then((r) => r.data);

export const createJob = (queueId: string, body: Record<string, unknown>) =>
  api.post(`/queues/${queueId}/jobs`, body).then((r) => r.data.data);

export const getJobDetail = (jobId: string) => api.get(`/jobs/${jobId}`).then((r) => r.data.data);
export const cancelJob = (jobId: string) => api.post(`/jobs/${jobId}/cancel`).then((r) => r.data.data);
export const getFailureSummary = (jobId: string) =>
  api.get(`/jobs/${jobId}/failure-summary`).then((r) => r.data.data);

// ---- Scheduled (cron) jobs ----
export const listScheduledJobs = (queueId: string) =>
  api.get(`/queues/${queueId}/scheduled-jobs`).then((r) => r.data.data);

export const createScheduledJob = (queueId: string, body: Record<string, unknown>) =>
  api.post(`/queues/${queueId}/scheduled-jobs`, body).then((r) => r.data.data);

export const pauseScheduledJob = (id: string) => api.post(`/scheduled-jobs/${id}/pause`).then((r) => r.data.data);
export const resumeScheduledJob = (id: string) => api.post(`/scheduled-jobs/${id}/resume`).then((r) => r.data.data);

// ---- Workers ----
export const listWorkers = (projectId: string) =>
  api.get(`/projects/${projectId}/workers`).then((r) => r.data.data);

export const getWorkerHeartbeats = (workerId: string) =>
  api.get(`/workers/${workerId}/heartbeats`).then((r) => r.data.data);

// ---- Dead letter queue ----
export const listDeadLetter = (queueId: string, page = 1, pageSize = 20) =>
  api.get(`/queues/${queueId}/dead-letter`, { params: { page, pageSize } }).then((r) => r.data);

export const requeueDeadLetter = (entryId: string) =>
  api.post(`/dead-letter/${entryId}/requeue`).then((r) => r.data.data);

// ---- Metrics ----
export const getThroughput = (projectId: string, minutes = 60) =>
  api.get(`/projects/${projectId}/metrics/throughput`, { params: { minutes } }).then((r) => r.data.data);

export const getProjectHealth = (projectId: string) =>
  api.get(`/projects/${projectId}/metrics/health`).then((r) => r.data.data);
