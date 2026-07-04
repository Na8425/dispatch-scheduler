import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import {
  createScheduledJob,
  listScheduledJobs,
  setScheduledJobActive,
} from '../services/scheduledJob.service';

const createSchema = z.object({
  name: z.string().min(1).max(120),
  taskName: z.string().min(1).max(200),
  payloadTemplate: z.record(z.unknown()).optional(),
  cronExpression: z.string().min(1),
  timezone: z.string().optional(),
  priority: z.number().int().optional(),
  retryPolicyId: z.string().uuid().nullable().optional(),
});

// Mounted at /api/v1/queues/:queueId/scheduled-jobs
export const queueScheduledJobsRouter = Router({ mergeParams: true });
queueScheduledJobsRouter.use(requireAuth);

queueScheduledJobsRouter.post(
  '/',
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const def = await createScheduledJob(req.params.queueId, req.body);
    res.status(201).json({ data: def });
  })
);

queueScheduledJobsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const defs = await listScheduledJobs(req.params.queueId);
    res.json({ data: defs });
  })
);

// Mounted at /api/v1/scheduled-jobs/:scheduledJobId
export const scheduledJobRouter = Router({ mergeParams: true });
scheduledJobRouter.use(requireAuth);

scheduledJobRouter.post(
  '/pause',
  asyncHandler(async (req, res) => {
    const def = await setScheduledJobActive(req.params.scheduledJobId, false);
    res.json({ data: def });
  })
);

scheduledJobRouter.post(
  '/resume',
  asyncHandler(async (req, res) => {
    const def = await setScheduledJobActive(req.params.scheduledJobId, true);
    res.json({ data: def });
  })
);
