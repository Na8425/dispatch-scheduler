import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { asyncHandler } from '../utils/asyncHandler';
import { parsePageParams, buildPageMeta } from '../utils/pagination';
import {
  createJob,
  createBatch,
  getBatchStatus,
  getJobDetail,
  cancelJob,
  listJobs,
} from '../services/job.service';
import { getQueue } from '../services/queue.service';
import { summarizeJobFailures } from '../services/failureSummary.service';

const jobInputSchema = z.object({
  taskName: z.string().min(1).max(200),
  payload: z.record(z.unknown()).optional(),
  priority: z.number().int().min(-100).max(100).optional(),
  runAt: z.string().datetime().optional(),
  delayMs: z.number().int().min(0).max(1000 * 60 * 60 * 24 * 30).optional(), // cap at 30 days
  idempotencyKey: z.string().max(200).optional(),
  retryPolicyId: z.string().uuid().nullable().optional(),
  dependsOnJobIds: z.array(z.string().uuid()).max(50).optional(),
});

const batchSchema = z.object({
  jobs: z.array(jobInputSchema).min(1).max(1000),
});

// Mounted at /api/v1/queues/:queueId/jobs
export const queueJobsRouter = Router({ mergeParams: true });
queueJobsRouter.use(requireAuth);

queueJobsRouter.post(
  '/',
  rateLimit(120, 60),
  validate(jobInputSchema),
  asyncHandler(async (req, res) => {
    const queue = await getQueue(req.params.queueId);
    const job = await createJob(queue.id, queue.project_id, req.body);
    res.status(201).json({ data: job });
  })
);

queueJobsRouter.post(
  '/batch',
  rateLimit(20, 60),
  validate(batchSchema),
  asyncHandler(async (req, res) => {
    const queue = await getQueue(req.params.queueId);
    const result = await createBatch(queue.id, queue.project_id, req.body.jobs);
    res.status(201).json({ data: result });
  })
);

const listQuerySchema = z.object({
  status: z.string().optional(),
  taskName: z.string().optional(),
  page: z.string().optional(),
  pageSize: z.string().optional(),
});

queueJobsRouter.get(
  '/',
  validate(listQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const { page, pageSize } = parsePageParams(req.query as any);
    const { total, jobs } = await listJobs({
      queueId: req.params.queueId,
      status: (req.query as any).status,
      taskName: (req.query as any).taskName,
      page,
      pageSize,
    });
    res.json({ data: jobs, meta: buildPageMeta(total, { page, pageSize }) });
  })
);

// Mounted at /api/v1/jobs/:jobId
export const jobRouter = Router({ mergeParams: true });
jobRouter.use(requireAuth);

jobRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const detail = await getJobDetail(req.params.jobId);
    res.json({ data: detail });
  })
);

jobRouter.post(
  '/cancel',
  asyncHandler(async (req, res) => {
    const job = await cancelJob(req.params.jobId);
    res.json({ data: job });
  })
);

jobRouter.get(
  '/failure-summary',
  asyncHandler(async (req, res) => {
    const summary = await summarizeJobFailures(req.params.jobId);
    res.json({ data: summary });
  })
);

// Mounted at /api/v1/batches/:batchId
export const batchRouter = Router({ mergeParams: true });
batchRouter.use(requireAuth);
batchRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const status = await getBatchStatus(req.params.batchId);
    res.json({ data: status });
  })
);
