import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { parsePageParams, buildPageMeta } from '../utils/pagination';
import { listDeadLetterEntries, requeueFromDeadLetter } from '../services/deadLetter.service';

// Mounted at /api/v1/queues/:queueId/dead-letter
export const queueDlqRouter = Router({ mergeParams: true });
queueDlqRouter.use(requireAuth);

queueDlqRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, pageSize } = parsePageParams(req.query as any);
    const { total, entries } = await listDeadLetterEntries(req.params.queueId, page, pageSize);
    res.json({ data: entries, meta: buildPageMeta(total, { page, pageSize }) });
  })
);

// Mounted at /api/v1/dead-letter/:entryId
export const dlqEntryRouter = Router({ mergeParams: true });
dlqEntryRouter.use(requireAuth);

dlqEntryRouter.post(
  '/requeue',
  asyncHandler(async (req, res) => {
    const job = await requeueFromDeadLetter(req.params.entryId, req.user!.id);
    res.json({ data: job });
  })
);
