import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import pinoHttp from 'pino-http';
import { env } from './config/env';
import { logger } from './utils/logger';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { initSocketGateway } from './ws/socket';

import authRoutes from './routes/auth.routes';
import projectRoutes, { projectDetailRouter } from './routes/projects.routes';
import { projectQueuesRouter, queueRouter } from './routes/queues.routes';
import { retryPoliciesRouter } from './routes/retryPolicies.routes';
import { queueJobsRouter, jobRouter, batchRouter } from './routes/jobs.routes';
import { projectWorkersRouter, workerRouter } from './routes/workers.routes';
import { queueDlqRouter, dlqEntryRouter } from './routes/dlq.routes';
import { queueScheduledJobsRouter, scheduledJobRouter } from './routes/scheduledJobs.routes';
import { metricsRouter } from './routes/metrics.routes';

const corsOptions: cors.CorsOptions = {
  origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
    if (!origin) {
      cb(null, true);
      return;
    }
    const isLocalhost = origin.startsWith('http://localhost:') || origin === 'http://localhost';
    const isVercel = origin.endsWith('.vercel.app');
    const isConfigured = process.env.FRONTEND_URL ? origin === process.env.FRONTEND_URL.replace(/\/$/, '') : false;

    if (isLocalhost || isVercel || isConfigured) {
      cb(null, true);
    } else {
      cb(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // handle preflight for all routes


app.use(express.json({ limit: '2mb' }));
app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' } }));

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'job-scheduler-api' }));

const v1 = express.Router();

// Auth
v1.use('/auth', authRoutes);

// Organizations -> Projects
v1.use('/organizations/:orgId/projects', projectRoutes);
v1.use('/projects', projectDetailRouter);

// Project-scoped resources
v1.use('/projects/:projectId/queues', projectQueuesRouter);
v1.use('/projects/:projectId/retry-policies', retryPoliciesRouter);
v1.use('/projects/:projectId/workers', projectWorkersRouter);
v1.use('/projects/:projectId/metrics', metricsRouter);

// Queue-scoped resources
v1.use('/queues/:queueId', queueRouter);
v1.use('/queues/:queueId/jobs', queueJobsRouter);
v1.use('/queues/:queueId/dead-letter', queueDlqRouter);
v1.use('/queues/:queueId/scheduled-jobs', queueScheduledJobsRouter);

// Flat resources
v1.use('/jobs/:jobId', jobRouter);
v1.use('/batches/:batchId', batchRouter);
v1.use('/workers/:workerId', workerRouter);
v1.use('/dead-letter/:entryId', dlqEntryRouter);
v1.use('/scheduled-jobs/:scheduledJobId', scheduledJobRouter);

app.use('/api/v1', v1);

app.use(notFoundHandler);
app.use(errorHandler);

const httpServer = createServer(app);
initSocketGateway(httpServer);

if (require.main === module) {
  httpServer.listen(env.port, () => {
    logger.info(`API server listening on port ${env.port}`);
  });
}

export { app, httpServer };
