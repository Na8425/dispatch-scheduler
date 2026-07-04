import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { requireAuth, requireRole } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import {
  createQueue,
  listQueues,
  getQueue,
  updateQueue,
  setQueuePaused,
  getQueueStats,
} from '../services/queue.service';

const createSchema = z.object({
  name: z.string().min(1).max(120),
  priority: z.number().int().min(-100).max(100).optional(),
  maxConcurrency: z.number().int().min(1).max(1000).optional(),
  retryPolicyId: z.string().uuid().nullable().optional(),
  rateLimitPerSec: z.number().int().min(1).nullable().optional(),
});

const updateSchema = createSchema.partial();

// Mounted at /api/v1/projects/:projectId/queues
export const projectQueuesRouter = Router({ mergeParams: true });
projectQueuesRouter.use(requireAuth);

projectQueuesRouter.post(
  '/',
  requireRole('admin'),
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const queue = await createQueue(req.params.projectId, req.body);
    res.status(201).json({ data: queue });
  })
);

projectQueuesRouter.get(
  '/',
  requireRole('viewer'),
  asyncHandler(async (req, res) => {
    const queues = await listQueues(req.params.projectId);
    res.json({ data: queues });
  })
);

// Mounted at /api/v1/queues/:queueId
export const queueRouter = Router({ mergeParams: true });
queueRouter.use(requireAuth);

queueRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const queue = await getQueue(req.params.queueId);
    res.json({ data: queue });
  })
);

queueRouter.patch(
  '/',
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const queue = await updateQueue(req.params.queueId, req.body);
    res.json({ data: queue });
  })
);

queueRouter.post(
  '/pause',
  asyncHandler(async (req, res) => {
    const queue = await setQueuePaused(req.params.queueId, true);
    res.json({ data: queue });
  })
);

queueRouter.post(
  '/resume',
  asyncHandler(async (req, res) => {
    const queue = await setQueuePaused(req.params.queueId, false);
    res.json({ data: queue });
  })
);

queueRouter.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const stats = await getQueueStats(req.params.queueId);
    res.json({ data: stats });
  })
);
